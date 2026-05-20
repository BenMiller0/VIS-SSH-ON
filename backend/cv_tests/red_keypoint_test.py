"""Require the current red keypoint to be visible."""

import vis_ssh_on as vis


def main() -> None:
    red = vis.keypoint("red").should_be_visible()
    vis.pass_test(x=red.x, y=red.y, area=red.area)


if __name__ == "__main__":
    main()
