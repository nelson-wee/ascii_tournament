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
  /** Run the rest of the round at once (Section 7.18). */
  onSkip: () => void;
}

const LABELS: Readonly<Record<Speed, string>> = {
  0: "Pause",
  1: "1×",
  4: "4×",
};

export interface SpeedControls {
  /** Show which speed is active. */
  setSpeed(speed: Speed): void;
  /** Turn every button off at the end of a round. */
  setEnabled(enabled: boolean): void;
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

  const skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.textContent = "Skip";
  skipButton.title = "Run to the end of the round";
  skipButton.addEventListener("click", () => {
    options.onSkip();
    paint(0);
  });
  container.append(skipButton);

  paint(options.initialSpeed);
  return {
    setSpeed: paint,
    setEnabled(enabled: boolean): void {
      for (const button of [...buttons.values(), stepButton, skipButton]) {
        button.disabled = !enabled;
      }
    },
  };
}
