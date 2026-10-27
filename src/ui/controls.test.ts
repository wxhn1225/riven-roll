import { describe, expect, it } from "vitest";
import { fieldSize, parseTyped } from "./controls";

describe("typed numbers", () => {
  it("reads a decimal comma the way some game settings show it", () => {
    expect(parseTyped("104,5")).toBe(104.5);
    expect(parseTyped("+104,5%")).toBe(104.5);
    expect(parseTyped("x1,49")).toBe(1.49);
    expect(parseTyped("-47,1")).toBe(-47.1);
  });

  it("still reads dots and thousands commas", () => {
    expect(parseTyped("104.5")).toBe(104.5);
    expect(parseTyped("1,234")).toBe(1234);
    expect(parseTyped("6,420,000")).toBe(6420000);
    expect(parseTyped("1,234.5")).toBe(1234.5);
    expect(parseTyped("")).toBeNull();
    expect(Number.isNaN(parseTyped("abc"))).toBe(true);
  });
});

describe("number box width", () => {
  it("grows to show its whole text, a Chinese character taking two", () => {
    expect(fieldSize("1.07", 4)).toBe(4);
    expect(fieldSize("1.0365", 4)).toBe(6);
    expect(fieldSize("out of reach", 4)).toBe(12);
    expect(fieldSize("达不到", 4)).toBe(6);
    expect(fieldSize("", 6)).toBe(6);
  });
});
