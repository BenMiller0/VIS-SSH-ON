"""Rotation-direction test for the red blob keypoint."""
 
import json
import math

from vis_ssh_on import detected_points, fail, load_payload, pass_test

EXPECTED_DIRECTION = "clockwise"


def predict_rotation(points: list[dict]) -> tuple[str, float]:
    width = next((p.get("frame_width") for p in points if p.get("frame_width")), None)
    height = next((p.get("frame_height") for p in points if p.get("frame_height")), None)
    if not width or not height:
        return "waiting", 0.0

    center_x = width / 2
    center_y = height / 2
    previous = math.atan2(points[0]["y"] - center_y, points[0]["x"] - center_x)
    total_delta = 0.0

    for point in points[1:]:
        current = math.atan2(point["y"] - center_y, point["x"] - center_x)
        delta = current - previous
        while delta > math.pi:
            delta -= 2 * math.pi
        while delta < -math.pi:
            delta += 2 * math.pi
        total_delta += delta
        previous = current

    degrees = math.degrees(total_delta)
    if abs(degrees) < 8:
        return "waiting", round(degrees, 2)
    return ("clockwise" if total_delta > 0 else "counterclockwise"), round(degrees, 2)


def main() -> None:
    payload = load_payload()
    points = detected_points(payload)
    if len(points) < 2:
        print(json.dumps({
            "prediction": "waiting",
            "expected": EXPECTED_DIRECTION,
            "samples": len(points),
        }))
        fail("need at least two detected red blob samples", samples=len(points))

    observed, degrees = predict_rotation(points)
    prediction = {
        "prediction": observed,
        "expected": EXPECTED_DIRECTION,
        "samples": len(points),
        "delta_deg": degrees,
    }

    print(json.dumps(prediction))

    if observed == "waiting":
        fail("red blob did not rotate enough", **prediction)

    if observed != EXPECTED_DIRECTION:
        fail(
            "wrong rotation direction",
            **prediction,
        )

    pass_test(**prediction)


if __name__ == "__main__":
    main()
