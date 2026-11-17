"""Independent, manually verified expected-field manifest for NSD 16-page application.

Coordinates are `(expected_type, cx, cy, label_hint)` in display points (72 DPI)
derived from inspecting the rendered NSD PDF pages (`NNSDFILLABLEAPP (1).pdf`).
"""

from typing import Dict, List, Tuple

# (field_type, center_x, center_y, label_hint)
ExpectedField = Tuple[str, float, float, str]

# Page 2 (index 1): 71 controls = 18 radiobuttons (9 Yes/No pairs) + 40 checkboxes + 13 text fields
PAGE_2_EXPECTED: List[ExpectedField] = [
    # Row 1: Do you have a repair facility? (Yes/No)
    ("radiobutton", 178.0, 39.5, "repair facility Yes"),
    ("radiobutton", 216.2, 40.1, "repair facility No"),
    # Row 2: If Yes, please list days and hours of operation
    ("text", 411.8, 64.8, "days and hours"),
    # Row 3: Do you sell tires? (Yes/No) + If yes, for: Auto / RV / Motorcycle / Trailer
    ("radiobutton", 124.8, 88.5, "sell tires Yes"),
    ("radiobutton", 164.4, 89.5, "sell tires No"),
    ("checkbox", 310.0, 89.7, "tires Auto"),
    ("checkbox", 355.2, 89.7, "tires RV"),
    ("checkbox", 392.7, 89.0, "tires Motorcycle"),
    ("checkbox", 466.2, 89.7, "tires Trailer"),
    # Row 4: Do you sell batteries? (Yes/No) + If yes, for: Auto / RV / Motorcycle / Trailer
    ("radiobutton", 144.6, 113.2, "sell batteries Yes"),
    ("radiobutton", 182.4, 113.8, "sell batteries No"),
    ("checkbox", 310.4, 114.6, "batteries Auto"),
    ("checkbox", 354.4, 114.6, "batteries RV"),
    ("checkbox", 392.7, 114.6, "batteries Motorcycle"),
    ("checkbox", 466.2, 114.6, "batteries Trailer"),
    # Row 5: Do you have a secure storage lot? (Yes/No)
    ("radiobutton", 196.0, 138.8, "secure storage lot Yes"),
    ("radiobutton", 236.0, 138.8, "secure storage lot No"),
    # Row 6: Do you provide accident scene towing? (Yes/No)
    ("radiobutton", 221.8, 163.5, "accident scene towing Yes"),
    ("radiobutton", 260.6, 164.4, "accident scene towing No"),
    # Row 7: Are you capable of any secondary accident towing? (Yes/No)
    ("radiobutton", 275.8, 190.2, "secondary accident towing Yes"),
    ("radiobutton", 314.6, 190.0, "secondary accident towing No"),
    # Row 8: Do you accept fax dispatch? (Yes/No) + 24/7 fax number
    ("radiobutton", 173.0, 229.0, "fax dispatch Yes"),
    ("radiobutton", 211.2, 229.0, "fax dispatch No"),
    ("text", 505.2, 230.0, "24/7 fax number"),
    # Row 9: Do you employ an answering service? (Yes/No) + hours
    ("radiobutton", 216.6, 253.0, "answering service Yes"),
    ("radiobutton", 255.3, 253.2, "answering service No"),
    ("text", 514.5, 255.0, "answering service hours"),
    # Row 10-11: Method of payment (8 checkboxes + Other text)
    ("checkbox", 319.0, 278.0, "American Express"),
    ("checkbox", 428.3, 278.4, "Visa"),
    ("checkbox", 476.2, 279.2, "Master Card"),
    ("checkbox", 51.6, 303.0, "ATM/Debit"),
    ("checkbox", 131.4, 304.0, "Fleet Card"),
    ("checkbox", 205.0, 303.2, "Personal Check"),
    ("checkbox", 303.0, 303.8, "Discover"),
    ("checkbox", 369.2, 303.2, "Other checkbox"),
    ("text", 491.8, 305.8, "Other text"),
    # Towing capabilities (7 checkboxes)
    ("checkbox", 96.4, 396.4, "Light Duty"),
    ("checkbox", 216.6, 396.4, "Medium Duty"),
    ("checkbox", 320.9, 396.4, "Heavy Duty"),
    ("checkbox", 415.6, 396.4, "Motorcycle Transport"),
    ("checkbox", 97.1, 421.1, "Unloading Service"),
    ("checkbox", 217.2, 421.1, "Luxury"),
    ("checkbox", 321.6, 421.1, "Exotic"),
    # Services capabilities (17 checkboxes)
    ("checkbox", 96.4, 458.6, "Jump Start"),
    ("checkbox", 217.2, 458.6, "Lockout"),
    ("checkbox", 326.4, 459.4, "Tire Change"),
    ("checkbox", 460.2, 459.8, "Tire Inflation"),
    ("checkbox", 95.2, 484.8, "Winching"),
    ("checkbox", 215.4, 484.4, "Windshield Repair"),
    ("checkbox", 326.8, 485.6, "Unleaded Fuel Delivery"),
    ("checkbox", 460.2, 485.6, "Diesel Fuel Delivery"),
    ("checkbox", 94.6, 509.8, "Flat Bed Towing"),
    ("checkbox", 216.2, 510.0, "Locksmith"),
    ("checkbox", 326.4, 509.2, "Low Clearance Towing"),
    ("checkbox", 459.4, 510.0, "Mobile Battery Sale"),
    ("checkbox", 94.6, 534.6, "Mobile Tire Sale"),
    ("checkbox", 216.6, 536.0, "Wheel Repair"),
    ("checkbox", 326.4, 534.6, "Paintless Dent Repair"),
    ("checkbox", 459.0, 534.6, "Motorcycle JumpStart"),
    ("checkbox", 95.2, 561.0, "Heavy Duty Jump Start"),
    # 24/7 services (Yes/No)
    ("radiobutton", 208.6, 600.4, "services 24/7 Yes"),
    ("radiobutton", 247.4, 599.6, "services 24/7 No"),
    # Equipment fleet counts (9 text fields)
    ("text", 101.9, 678.8, "Wheel Lift"),
    ("text", 179.6, 678.8, "Flatbed"),
    ("text", 347.0, 678.8, "Light Service Units"),
    ("text", 453.4, 678.8, "Medium Duty"),
    ("text", 552.6, 678.8, "Heavy Duty"),
    ("text", 104.6, 704.2, "Super Duty"),
    ("text", 218.7, 704.2, "Landoll/Lowboy"),
    ("text", 316.0, 704.2, "Fifth Wheel"),
    ("text", 422.4, 704.2, "Trailer"),
]

# Expected counts & type breakdown across all 16 pages
NSD_EXPECTED_PAGE_SUMMARY: Dict[int, Dict[str, int]] = {
    0: {"total": 39, "text": 25, "radiobutton": 14},
    1: {"total": 71, "radiobutton": 18, "checkbox": 40, "text": 13},
    2: {"total": 10, "checkbox": 6, "text": 2, "multiline": 1, "date": 1},
    3: {"total": 4, "text": 4},
    4: {"total": 0},
    5: {"total": 0},
    6: {"total": 6, "signature": 2, "text": 4},
    7: {"total": 0},
    8: {"total": 0},
    9: {"total": 0},
    10: {"total": 0},
    11: {"total": 5, "text": 5},
    12: {"total": 4, "signature": 2, "text": 2},
    13: {"total": 13, "text": 10, "checkbox": 1, "date": 1, "signature": 1},
    14: {"total": 0},
    15: {"total": 121, "text": 121},
}


def evaluate_page_against_expected(
    detected: List[dict],
    expected: List[ExpectedField],
    center_tol_box: float = 14.0,
    center_tol_text: float = 28.0,
) -> Dict[str, float]:
    """Match detected candidates against independent expected fields using geometry and type."""
    matched_expected = set()
    matched_detected = set()
    true_positives = 0
    incorrect_types = 0
    duplicates = 0

    # Track how many detected fields fall near each expected field
    exp_match_counts: Dict[int, int] = {i: 0 for i in range(len(expected))}

    for d_idx, d in enumerate(detected):
        bx = d["bbox"]
        dcx = (bx[0] + bx[2]) / 2.0
        dcy = (bx[1] + bx[3]) / 2.0
        best_e = None
        best_dist = 1e9
        for e_idx, (etype, ecx, ecy, _) in enumerate(expected):
            tol = center_tol_text if etype in ("text", "multiline", "date", "signature") else center_tol_box
            dist = ((dcx - ecx) ** 2 + (dcy - ecy) ** 2) ** 0.5
            if dist <= tol and dist < best_dist:
                best_dist = dist
                best_e = e_idx
        if best_e is not None:
            exp_match_counts[best_e] += 1
            if best_e not in matched_expected:
                matched_expected.add(best_e)
                matched_detected.add(d_idx)
                if d["field_type"] == expected[best_e][0]:
                    true_positives += 1
                else:
                    incorrect_types += 1
            else:
                duplicates += 1

    false_negatives = len(expected) - len(matched_expected)
    false_positives = len(detected) - len(matched_detected) - duplicates
    precision = true_positives / max(1, len(detected))
    recall = true_positives / max(1, len(expected))
    return {
        "expected": len(expected),
        "detected": len(detected),
        "true_positives": true_positives,
        "false_negatives": false_negatives,
        "false_positives": false_positives,
        "incorrect_types": incorrect_types,
        "duplicates": duplicates,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
    }

