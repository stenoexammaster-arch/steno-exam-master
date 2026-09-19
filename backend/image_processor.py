from __future__ import annotations

import cv2
import numpy as np


def _deskew(gray: np.ndarray) -> np.ndarray:
    # Simple deskew using minAreaRect on text pixels
    # Works okay for typical scanned docs
    inv = cv2.bitwise_not(gray)
    thresh = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

    coords = np.column_stack(np.where(thresh > 0))
    if coords.size == 0:
        return gray

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    (h, w) = gray.shape[:2]
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    rotated = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated


def preprocess(bgr: np.ndarray, options: dict) -> np.ndarray:
    """
    bgr: OpenCV image
    returns: processed grayscale image (uint8)
    """
    denoise = bool(options.get("denoise", True))
    deskew = bool(options.get("deskew", True))
    contrast = bool(options.get("contrast", True))

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    if contrast:
        # CLAHE improves scanned text
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)

    if denoise:
        gray = cv2.fastNlMeansDenoising(gray, None, 20, 7, 21)

    if deskew:
        gray = _deskew(gray)

    # Binarize for OCR
    gray = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    return gray