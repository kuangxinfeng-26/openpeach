import { describe, expect, it } from "vitest";
import { parseDeviceIntent } from "./device-intent.js";

describe("parseDeviceIntent", () => {
  describe("living-room-lamp", () => {
    it("matches English alias 'living room lamp'", () => {
      const result = parseDeviceIntent("turn on the living room lamp");
      expect(result).toEqual({
        deviceId: "mock:living-room-lamp",
        matchedAlias: "living room lamp",
        action: "turn_on",
      });
    });

    it("matches English alias 'living room light'", () => {
      const result = parseDeviceIntent("is the living room light on?");
      expect(result?.deviceId).toBe("mock:living-room-lamp");
      expect(result?.matchedAlias).toBe("living room light");
    });

    it("matches Chinese alias '客厅灯'", () => {
      const result = parseDeviceIntent("请帮我打开客厅灯");
      expect(result).toEqual({
        deviceId: "mock:living-room-lamp",
        matchedAlias: "客厅灯",
        action: "turn_on",
      });
    });

    it("matches Chinese alias '客厅的灯'", () => {
      const result = parseDeviceIntent("客厅的灯关掉");
      expect(result).toEqual({
        deviceId: "mock:living-room-lamp",
        matchedAlias: "客厅的灯",
        action: "turn_off",
      });
    });

    it("matches Chinese alias '大厅灯'", () => {
      const result = parseDeviceIntent("大厅灯什么情况");
      expect(result).toEqual({
        deviceId: "mock:living-room-lamp",
        matchedAlias: "大厅灯",
        action: "read_state",
      });
    });
  });

  describe("front-camera", () => {
    it("matches 'front camera'", () => {
      const result = parseDeviceIntent("check the front camera");
      expect(result?.deviceId).toBe("mock:front-camera");
      expect(result?.action).toBe("read_state");
    });

    it("matches 'camera'", () => {
      const result = parseDeviceIntent("start camera recording");
      expect(result).toEqual({
        deviceId: "mock:front-camera",
        matchedAlias: "camera",
        action: "start_recording",
      });
    });

    it("matches '摄像头'", () => {
      const result = parseDeviceIntent("摄像头状态");
      expect(result).toEqual({
        deviceId: "mock:front-camera",
        matchedAlias: "摄像头",
        action: "read_state",
      });
    });

    it("matches '前门摄像头'", () => {
      const result = parseDeviceIntent("前门摄像头录像");
      expect(result?.deviceId).toBe("mock:front-camera");
      expect(result?.action).toBe("start_recording");
    });

    it("matches '监控'", () => {
      const result = parseDeviceIntent("看看监控");
      expect(result?.deviceId).toBe("mock:front-camera");
    });
  });

  describe("toy:story-bunny", () => {
    it("matches 'story bunny'", () => {
      const result = parseDeviceIntent("trigger story bunny bedtime");
      expect(result).toEqual({
        deviceId: "toy:story-bunny",
        matchedAlias: "story bunny",
        action: "trigger_play_scene",
      });
    });

    it("matches '淘气兔'", () => {
      const result = parseDeviceIntent("让淘气兔讲故事");
      expect(result?.deviceId).toBe("toy:story-bunny");
      expect(result?.action).toBe("trigger_play_scene");
    });

    it("matches '故事兔'", () => {
      const result = parseDeviceIntent("故事兔播放睡前故事");
      expect(result?.deviceId).toBe("toy:story-bunny");
      expect(result?.action).toBe("trigger_play_scene");
    });

    it("matches '故事机'", () => {
      const result = parseDeviceIntent("故事机开一下");
      expect(result?.deviceId).toBe("toy:story-bunny");
      expect(result?.action).toBe("turn_on");
    });
  });

  describe("action detection", () => {
    it("detects turn_on from 'turn on'", () => {
      const result = parseDeviceIntent("turn on the living room lamp");
      expect(result?.action).toBe("turn_on");
    });

    it("detects turn_on from 'switch on'", () => {
      const result = parseDeviceIntent("switch on the living room light");
      expect(result?.action).toBe("turn_on");
    });

    it("detects turn_off from 'turn off'", () => {
      const result = parseDeviceIntent("turn off the living room lamp");
      expect(result?.action).toBe("turn_off");
    });

    it("detects turn_off from 'close'", () => {
      const result = parseDeviceIntent("close the living room lamp");
      expect(result?.action).toBe("turn_off");
    });

    it("detects turn_on from '打开'", () => {
      const result = parseDeviceIntent("打开客厅灯");
      expect(result?.action).toBe("turn_on");
    });

    it("detects turn_off from '关闭'", () => {
      const result = parseDeviceIntent("关闭客厅灯");
      expect(result?.action).toBe("turn_off");
    });

    it("detects turn_off from '关掉'", () => {
      const result = parseDeviceIntent("把客厅灯关掉");
      expect(result?.action).toBe("turn_off");
    });

    it("detects turn_off from '熄灭'", () => {
      const result = parseDeviceIntent("熄灭客厅灯");
      expect(result?.action).toBe("turn_off");
    });

    it("detects read_state from 'status'", () => {
      const result = parseDeviceIntent("living room lamp status");
      expect(result?.action).toBe("read_state");
    });

    it("detects read_state from 'check'", () => {
      const result = parseDeviceIntent("check the front camera");
      expect(result?.action).toBe("read_state");
    });

    it("detects read_state from '状态'", () => {
      const result = parseDeviceIntent("客厅灯状态");
      expect(result?.action).toBe("read_state");
    });

    it("detects read_state from '什么情况'", () => {
      const result = parseDeviceIntent("客厅灯什么情况");
      expect(result?.action).toBe("read_state");
    });

    it("detects start_recording from 'record'", () => {
      const result = parseDeviceIntent("record from front camera");
      expect(result?.action).toBe("start_recording");
    });

    it("detects trigger_play_scene from 'play'", () => {
      const result = parseDeviceIntent("play a story on story bunny");
      expect(result?.action).toBe("trigger_play_scene");
    });

    it("detects trigger_play_scene from '讲故事'", () => {
      const result = parseDeviceIntent("淘气兔讲故事");
      expect(result?.action).toBe("trigger_play_scene");
    });

    it("detects trigger_play_scene from '睡前'", () => {
      const result = parseDeviceIntent("故事兔睡前模式");
      expect(result?.action).toBe("trigger_play_scene");
    });

    it("returns no action when text has no recognizable verb", () => {
      const result = parseDeviceIntent("living room lamp");
      expect(result?.deviceId).toBe("mock:living-room-lamp");
      expect(result?.action).toBeUndefined();
    });
  });

  describe("no match", () => {
    it("returns undefined for unrelated text", () => {
      expect(parseDeviceIntent("chat with me")).toBeUndefined();
    });

    it("returns undefined for empty text", () => {
      expect(parseDeviceIntent("")).toBeUndefined();
    });

    it("returns undefined for random Chinese text", () => {
      expect(parseDeviceIntent("今天天气怎么样")).toBeUndefined();
    });
  });

  describe("case insensitivity", () => {
    it("matches regardless of case", () => {
      const result = parseDeviceIntent("Turn On The LIVING ROOM LAMP");
      expect(result?.deviceId).toBe("mock:living-room-lamp");
      expect(result?.action).toBe("turn_on");
    });
  });
});
