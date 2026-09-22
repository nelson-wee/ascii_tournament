/**
 * The speed control buttons (dev-guide Section 7.18). Browser only.
 * The buttons are large, so that they work on a touch screen.
 */
import { SPEEDS, type Speed } from "../render/runner.js";

export interface SpeedControlsOptions {
  container: HTMLElement;
  initialSpeed: Speed;
  onSpeed: (speed: Speed) => void;
  onStep: () => void;
}

const LABELS: Readonly<Record<Speed, string>> = {
  0: "Pause",
  1: "1×",
  4: "4×",
};

export interface SpeedControls {
  /** Show which speed is active. */
  setSpeed(speed: Speed): void;
}

export function createSpeedControls(options: SpeedControlsOptions): SpeedControls {
  const { container } = options;
  container.replaceChildren();

  const buttons = new Map<Speed, HTMLButtonElement>();

  function paint(active: Speed): void {
    for (const [speed, button] of buttons) {
      button.setAttribute("aria-pressed", String(speed === active));
    }
  }

  for (const speed of SPEEDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = LABELS[speed];
    button.addEventListener("click", () => {
      options.onSpeed(speed);
      paint(speed);
    });
    buttons.set(speed, button);
    container.append(button);
  }

  const stepButton = document.createElement("button");
  stepButton.type = "button";
  stepButton.textContent = "Step";
  stepButton.title = "Run one tick";
  stepButton.addEventListener("click", () => {
    options.onSpeed(0);
    paint(0);
    options.onStep();
  });
  container.append(stepButton);

  paint(options.initialSpeed);
  return { setSpeed: paint };
}
