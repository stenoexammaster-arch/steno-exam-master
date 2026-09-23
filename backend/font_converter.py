from __future__ import annotations

"""
MVP: Legacy font conversion is complex (KrutiDev/DevLys/Chanakya mappings).
Here we keep a plug-in style function.
You can later add mapping dictionaries and conversion rules here.
"""

def convert_legacy_hindi_to_unicode(text: str, font_mode: str) -> str:
    """
    font_mode: auto | unicode | krutidev | chanakya | devlys
    For now: returns text as-is.
    Next step: implement mapping tables per font.
    """
    if not text:
        return text

    # If user forces Unicode, do nothing
    if font_mode in ("unicode", "auto"):
        return text

    # Placeholder for legacy conversion (to be implemented)
    # Example:
    # if font_mode == "krutidev": return krutidev_to_unicode(text)
    return text