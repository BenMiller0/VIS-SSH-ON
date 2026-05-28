"""Require three red keypoints to be visible and trackable over time."""
import vis_ssh_on as vis

def main() -> None:
    red = (
        vis.keypoints("red", count=3)
        .should_be_visible(min_area=10)
        .should_have_moved(at_least=8)
    )

    vis.pass_test(
        red_keypoint_count=len(red),
        coordinates=red.coordinates,
        areas=red.areas,
    )

if __name__ == "__main__":
    main()
