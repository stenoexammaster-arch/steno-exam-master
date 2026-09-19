from __future__ import annotations

import time
from pathlib import Path
from typing import Callable, Optional
import threading

import fitz  # PyMuPDF
import cv2
import numpy as np
from PIL import Image
import pytesseract
from docx import Document
from pypdf import PdfMerger

from .image_processor import preprocess
from .font_converter import convert_legacy_hindi_to_unicode


def _tess_lang(language: str) -> str:
    # Tesseract language codes: eng, hin, eng+hin
    if language == "eng":
        return "eng"
    if language == "hin":
        return "hin"
    if language == "mixed":
        return "eng+hin"
    return "eng"


def _set_tesseract_path_if_needed():
    """
    If tesseract is not in PATH, uncomment and set correct path.
    Example Windows:
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    """
    # import pytesseract
    # pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    return


def _render_pdf_pages(pdf_path: Path, dpi: int = 300):
    doc = fitz.open(str(pdf_path))
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    for i in range(doc.page_count):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        # pix.n usually 3 (RGB)
        bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        yield (i + 1, doc.page_count, bgr)
    doc.close()


def _load_image_pages(image_path: Path):
    # supports single image; TIFF multi-page could be added later
    pil = Image.open(str(image_path))
    # If multi-frame (tiff)
    try:
        frames = []
        i = 0
        while True:
            pil.seek(i)
            frame = pil.convert("RGB")
            frames.append(frame)
            i += 1
    except EOFError:
        pass

    total = len(frames) if frames else 1
    if frames:
        for idx, frame in enumerate(frames, start=1):
            rgb = np.array(frame)
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            yield (idx, total, bgr)
    else:
        rgb = np.array(pil.convert("RGB"))
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        yield (1, 1, bgr)


def run_ocr_job(
    job_id: str,
    input_path: Path,
    options: dict,
    output_dir: Path,
    on_progress: Callable[[str, float, Optional[int], Optional[str]], None],
    pause_event: threading.Event,
    cancel_event: threading.Event
) -> Path:
    """
    Returns output file path.
    """
    _set_tesseract_path_if_needed()

    output = (options or {}).get("output", "docx")
    language = (options or {}).get("language", "eng")
    font_mode = (options or {}).get("fontMode", "auto")
    preprocessing = (options or {}).get("preprocessing", {}) or {}
    target_dpi = (options or {}).get("targetDpi", "auto")

    tess_lang = _tess_lang(language)

    # DPI
    dpi = 300
    if isinstance(target_dpi, str) and target_dpi.isdigit():
        dpi = int(target_dpi)

    ext = input_path.suffix.lower()
    is_pdf = ext == ".pdf"

    on_progress("Preparing pages", 2.0, None, f"Input: {input_path.name}")

    pages_iter = _render_pdf_pages(input_path, dpi=dpi) if is_pdf else _load_image_pages(input_path)

    # Outputs
    now = int(time.time())
    base = f"{job_id}_{now}"

    if output == "txt":
        out_path = output_dir / f"{base}.txt"
        texts = []
        total_pages_known = None

        for page_no, total_pages, bgr in pages_iter:
            if cancel_event.is_set():
                break

            while pause_event.is_set() and not cancel_event.is_set():
                on_progress("Paused", 0.0, None, "Paused...")
                time.sleep(0.4)

            total_pages_known = total_pages
            on_progress("Preprocessing", (page_no / total_pages) * 100 * 0.2, None, f"Page {page_no}/{total_pages}")

            gray = preprocess(bgr, preprocessing)

            on_progress("OCR", 20 + (page_no / total_pages) * 70, None, f"OCR page {page_no}/{total_pages}")
            config = "--oem 1 --psm 6"
            text = pytesseract.image_to_string(gray, lang=tess_lang, config=config)

            # Legacy font conversion hook
            text = convert_legacy_hindi_to_unicode(text, font_mode=font_mode)
            texts.append(text.strip() + "\n")

        out_path.write_text("\n".join(texts), encoding="utf-8")
        on_progress("Finalizing", 98.0, None, "Writing TXT output")
        return out_path

    if output == "pdf_searchable":
        out_path = output_dir / f"{base}.pdf"
        merger = PdfMerger()

        for page_no, total_pages, bgr in pages_iter:
            if cancel_event.is_set():
                break

            while pause_event.is_set() and not cancel_event.is_set():
                on_progress("Paused", 0.0, None, "Paused...")
                time.sleep(0.4)

            gray = preprocess(bgr, preprocessing)
            on_progress("OCR to searchable PDF", 10 + (page_no / total_pages) * 85, None, f"Page {page_no}/{total_pages}")

            pdf_bytes = pytesseract.image_to_pdf_or_hocr(gray, lang=tess_lang, extension="pdf")
            tmp_pdf = output_dir / f"{base}_p{page_no:04d}.pdf"
            tmp_pdf.write_bytes(pdf_bytes)
            merger.append(str(tmp_pdf))

        with out_path.open("wb") as f:
            merger.write(f)
        merger.close()

        # cleanup temp pages
        for p in output_dir.glob(f"{base}_p*.pdf"):
            try:
                p.unlink()
            except Exception:
                pass

        on_progress("Finalizing", 99.0, None, "Searchable PDF ready")
        return out_path

    # default DOCX
    out_path = output_dir / f"{base}.docx"
    doc = Document()

    for page_no, total_pages, bgr in pages_iter:
        if cancel_event.is_set():
            break

        while pause_event.is_set() and not cancel_event.is_set():
            on_progress("Paused", 0.0, None, "Paused...")
            time.sleep(0.4)

        on_progress("Preprocessing", 10 + (page_no / total_pages) * 10, None, f"Page {page_no}/{total_pages}")
        gray = preprocess(bgr, preprocessing)

        on_progress("OCR", 20 + (page_no / total_pages) * 70, None, f"OCR page {page_no}/{total_pages}")
        config = "--oem 1 --psm 6"
        text = pytesseract.image_to_string(gray, lang=tess_lang, config=config)
        text = convert_legacy_hindi_to_unicode(text, font_mode=font_mode)

        # Write to docx, preserve basic paragraphs
        lines = [ln.rstrip() for ln in text.splitlines()]
        paragraph_buffer = []
        for ln in lines:
            if ln.strip() == "":
                if paragraph_buffer:
                    doc.add_paragraph(" ".join(paragraph_buffer).strip())
                    paragraph_buffer = []
            else:
                paragraph_buffer.append(ln.strip())

        if paragraph_buffer:
            doc.add_paragraph(" ".join(paragraph_buffer).strip())

        if page_no != total_pages:
            doc.add_page_break()

    on_progress("Finalizing", 98.0, None, "Writing DOCX output")
    doc.save(str(out_path))
    on_progress("Completed", 100.0, 0, "DOCX ready")
    return out_path