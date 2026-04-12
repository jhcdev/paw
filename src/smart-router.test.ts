import { describe, expect, it } from "vitest";
import { routeMessage } from "./smart-router.js";

describe("routeMessage", () => {
  it("routes polite English review requests to the review skill", () => {
    expect(routeMessage("please review this code", false, true)).toEqual({
      mode: "skill",
      skillName: "review",
      context: "please review this code",
    });
  });

  it("routes Korean analyze-and-fix requests to auto mode", () => {
    expect(routeMessage("현재 니가 돌고있는 paw는 어떤점이 약점인것같아? 파악해서 고쳐줄래?", false, true)).toEqual({
      mode: "auto",
      reason: "Complex implementation task detected",
    });
  });

  it("routes English diagnose-and-fix requests to auto mode", () => {
    expect(routeMessage("find the weak points in this project and fix them", false, true)).toEqual({
      mode: "auto",
      reason: "Complex implementation task detected",
    });
  });

  it("keeps pure shell commands on pipe mode", () => {
    expect(routeMessage("npm test", false, true)).toEqual({
      mode: "pipe",
      command: "npm test",
      subMode: "analyze",
    });
  });

  it("routes recall-style prompts to the sessions builtin", () => {
    expect(routeMessage("지난번 auth 버그 어떻게 고쳤지?", false, true)).toEqual({
      mode: "builtin",
      command: "/sessions auth 버그",
    });
  });

  it("routes tool and skill catalog prompts to builtins", () => {
    expect(routeMessage("what tools can you use?", false, true)).toEqual({
      mode: "builtin",
      command: "/tools",
    });
    expect(routeMessage("스킬 목록 보여줘", false, true)).toEqual({
      mode: "builtin",
      command: "/skills",
    });
  });

  it("keeps casual short prompts on solo mode", () => {
    expect(routeMessage("안녕", false, true)).toEqual({ mode: "solo" });
  });
});
