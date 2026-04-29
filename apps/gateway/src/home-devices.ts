import {
  createCompositeDeviceAdapter,
  createMockDeviceAdapter,
  type DeviceAdapter,
} from "../../../packages/device-adapter/src/index.js";
import { createStoryBunnyToyAdapter } from "../../../packages/toy-story-bunny/src/index.js";

export function createHomeDeviceAdapter(input: {
  enableStoryBunnyToy: boolean;
}): DeviceAdapter {
  const adapters = [createMockDeviceAdapter()];

  if (input.enableStoryBunnyToy) {
    adapters.push(createStoryBunnyToyAdapter());
  }

  return createCompositeDeviceAdapter(adapters);
}

export function enabledHomeDeviceIds(input: {
  enableStoryBunnyToy: boolean;
}): string[] {
  return input.enableStoryBunnyToy ? ["toy:story-bunny"] : [];
}
