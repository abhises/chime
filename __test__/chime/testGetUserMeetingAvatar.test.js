import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

const USER_SETTINGS_TABLE = "MeetingAttendees_UserProfiles";

describe("getUserMeetingAvatar", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    await ScyllaDb.loadTableConfigs("./tables.json");
  });

  beforeEach(() => {
    ErrorHandler.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("should return custom avatar if set", async () => {
    const avatarUrl = "https://cdn.site.com/avatar1.png";

    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce({
      UserId: "avatarUser1",
      AvatarUrl: avatarUrl,
    });

    const avatar = await Chime.getUserMeetingAvatar("avatarUser1");
    expect(avatar).toBe(avatarUrl);
  });

  test("should return null when avatar not set", async () => {
    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce({
      UserId: "avatarUser2",
    });

    const avatar = await Chime.getUserMeetingAvatar("avatarUser2");
    expect(avatar).toBeNull();
  });

  test("should return null for unknown user", async () => {
    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce(null);

    const avatar = await Chime.getUserMeetingAvatar("ghostAvatarUser");
    expect(avatar).toBeNull();
  });

  test("should reject null userId", async () => {
    await expect(Chime.getUserMeetingAvatar(null)).rejects.toThrow(
      "Missing required parameter: userId"
    );
  });

  test("should reject empty userId", async () => {
    await expect(Chime.getUserMeetingAvatar("")).rejects.toThrow(
      "Missing required parameter: userId"
    );
  });

  test("should return consistent avatar URL on multiple calls", async () => {
    const avatarUrl = "https://cdn.site.com/avatarX.png";

    jest.spyOn(ScyllaDb, "getItem").mockResolvedValue({
      UserId: "repeatAvatar",
      AvatarUrl: avatarUrl,
    });

    const a1 = await Chime.getUserMeetingAvatar("repeatAvatar");
    const a2 = await Chime.getUserMeetingAvatar("repeatAvatar");

    expect(a1).toBe(avatarUrl);
    expect(a2).toBe(avatarUrl);
  });

  test("should accept weird (non-https) avatar URL", async () => {
    const avatarUrl = "ftp://example.com/img.png";

    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce({
      UserId: "weirdAvatar",
      AvatarUrl: avatarUrl,
    });

    const avatar = await Chime.getUserMeetingAvatar("weirdAvatar");
    expect(avatar).toBe(avatarUrl);
  });

  test("should accept very long avatar URL", async () => {
    const longUrl = "https://cdn.site.com/" + "a".repeat(300) + ".png";

    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce({
      UserId: "longAvatar",
      AvatarUrl: longUrl,
    });

    const avatar = await Chime.getUserMeetingAvatar("longAvatar");
    expect(avatar).toBe(longUrl);
  });
});
