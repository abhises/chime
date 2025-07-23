import Chime from "../../chime/Chime.js";

describe("Channel Functions", () => {
  test("createChannel should execute without throwing and return null", async () => {
    await expect(Chime.createChannel()).resolves.toBeNull();
  });

  test("deleteChannel should execute without throwing and return null", async () => {
    await expect(Chime.deleteChannel()).resolves.toBeNull();
  });

  test("both createChannel and deleteChannel should return null", async () => {
    const createResult = await Chime.createChannel();
    const deleteResult = await Chime.deleteChannel();
    expect(createResult).toBeNull();
    expect(deleteResult).toBeNull();
  });

  test("multiple calls to createChannel and deleteChannel should succeed", async () => {
    await expect(Chime.createChannel()).resolves.toBeNull();
    await expect(Chime.createChannel()).resolves.toBeNull();
    await expect(Chime.deleteChannel()).resolves.toBeNull();
    await expect(Chime.deleteChannel()).resolves.toBeNull();
  });

  test("calling createChannel and deleteChannel in rapid succession should not throw", async () => {
    await expect(
      Promise.all([Chime.createChannel(), Chime.deleteChannel()])
    ).resolves.toEqual([null, null]);
  });
});
