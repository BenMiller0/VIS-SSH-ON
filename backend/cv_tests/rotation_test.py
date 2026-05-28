"""Rotation-direction test for the green blob keypoint."""
import vis_ssh_on as vis

EXPECTED_DIRECTION = "clockwise"

def main() -> None:
    green = vis.keypoint("red")
    observed, degrees = green.rotation()
    green.should_rotate(EXPECTED_DIRECTION)
    vis.pass_test(
        observed=observed,
        expected=EXPECTED_DIRECTION,
        samples=len(green.samples),
        delta_degrees=degrees,
    )

if __name__ == "__main__":
    main()
