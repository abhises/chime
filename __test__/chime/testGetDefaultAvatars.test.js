import Chime from "../../chime/Chime.js";

describe("getDefaultAvatars", () => {
  let avatars;

  beforeAll(async () => {
    avatars = await Chime.getDefaultAvatars();
  });

  test("should return an array", () => {
    expect(Array.isArray(avatars)).toBe(true);
  });

  test("should contain 3 entries", () => {
    expect(avatars.length).toBe(3);
  });

  test("should have all entries as strings", () => {
    const allStrings = avatars.every((url) => typeof url === "string");
    expect(allStrings).toBe(true);
  });

  test("should have all entries as valid URLs", () => {
    const urlPattern = /^https?:\/\/.+/;
    const allValidUrls = avatars.every((url) => urlPattern.test(url));
    expect(allValidUrls).toBe(true);
  });

  test("should not contain duplicate URLs", () => {
    const uniqueSet = new Set(avatars);
    expect(uniqueSet.size).toBe(avatars.length);
  });

  test("should all start with the expected CDN prefix", () => {
    const expectedPrefix = "https://cdn.example.com/";
    const allFromCDN = avatars.every((url) => url.startsWith(expectedPrefix));
    expect(allFromCDN).toBe(true);
  });

  test("should all end with .png", () => {
    const allPng = avatars.every((url) => url.endsWith(".png"));
    expect(allPng).toBe(true);
  });

  test("should return stable results across multiple calls", async () => {
    const avatarsAgain = await Chime.getDefaultAvatars();
    expect(avatarsAgain).toEqual(avatars);
  });

  test("should be JSON.stringify compatible", () => {
    expect(() => JSON.stringify(avatars)).not.toThrow();
    expect(JSON.stringify(avatars)).toContain(".png");
  });

  test("should be front-end ready for avatar pickers", () => {
    const isUsable = avatars.every((url) => url.startsWith("https://"));
    expect(isUsable).toBe(true);
  });
});
