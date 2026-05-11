const express = require("express");
const app = express();

const {
  Client,
  GatewayIntentBits,
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

/* ===================== DISCORD ===================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  console.error("TOKEN environment variable missing");
  process.exit(1);
}

/* ===================== EXPRESS ===================== */

app.get("/", (_, res) => {
  res.status(200).send("Bot alive");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Web server running on ${PORT}`);
});

/* ===================== READY ===================== */

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== SETTINGS ===================== */

const DISCORD_LIMIT_MB = 7.8;

const MAX_VIDEO_MB = 50;

const TEMP_DIR = path.join(__dirname, "temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

/* ===================== HELPERS ===================== */

function safeDelete(file) {
  try {
    if (file && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (err) {
    console.error("Delete error:", err);
  }
}

function getFileSizeMB(file) {
  return fs.statSync(file).size / 1024 / 1024;
}

function waitForStream(writer) {
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

function ffprobeAsync(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(data);
    });
  });
}

/* ===================== VIDEO INFO ===================== */

async function getVideoInfo(file) {

  const data = await ffprobeAsync(file);

  const stream = data.streams.find(
    s => s.codec_type === "video"
  );

  if (!stream) {
    throw new Error("No video stream found");
  }

  return {
    width: stream.width || 1280,
    height: stream.height || 720,
    duration: Number(
      stream.duration ||
      data.format.duration ||
      0
    ),
  };
}

/* ===================== GIF CREATION ===================== */

function createGif(
  input,
  output,
  fps,
  width,
  palette
) {

  return new Promise((resolve, reject) => {

    /* ---------- PALETTE ---------- */

    ffmpeg(input)

      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=max_colors=256`
      ])

      .save(palette)

      .on("end", () => {

        /* ---------- FINAL GIF ---------- */

        ffmpeg(input)

          .input(palette)

          .complexFilter([
            `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a`
          ])

          .outputOptions([
            "-loop", "0",

            // optimization
            "-gifflags", "-offsetting",

            // speed
            "-threads", "2",

            // overwrite
            "-y",
          ])

          .format("gif")

          .save(output)

          .on("end", resolve)

          .on("error", reject);

      })

      .on("error", reject);

  });

}

/* ===================== MESSAGE EVENT ===================== */

client.on("messageCreate", async (message) => {

  let input = null;
  let output = null;
  let palette = null;

  try {

    if (message.author.bot) return;

    const attachment = message.attachments.first();

    if (!attachment) return;

    if (
      !attachment.contentType ||
      !attachment.contentType.startsWith("video/")
    ) {
      return;
    }

    if (
      attachment.size >
      MAX_VIDEO_MB * 1024 * 1024
    ) {

      await message.reply(
        `Video exceeds ${MAX_VIDEO_MB}MB limit.`
      );

      return;
    }

    const progressMessage = await message.reply(
      "Creating high-quality GIF..."
    );

    const id =
      `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    input = path.join(
      TEMP_DIR,
      `input-${id}.mp4`
    );

    output = path.join(
      TEMP_DIR,
      `output-${id}.gif`
    );

    palette = path.join(
      TEMP_DIR,
      `palette-${id}.png`
    );

    /* ===================== DOWNLOAD ===================== */

    const response = await axios({
      url: attachment.url,
      method: "GET",
      responseType: "stream",
      timeout: 30000,
      maxContentLength:
        MAX_VIDEO_MB * 1024 * 1024,
    });

    const writer =
      fs.createWriteStream(input);

    response.data.pipe(writer);

    await waitForStream(writer);

    /* ===================== VIDEO INFO ===================== */

    const info = await getVideoInfo(input);

    console.log(info);

    /* ===================== SMART QUALITY ===================== */

    let fps = 20;
    let width = 720;

    if (info.duration > 8) {
      fps = 18;
      width = 640;
    }

    if (info.duration > 15) {
      fps = 14;
      width = 560;
    }

    if (info.duration > 25) {
      fps = 12;
      width = 480;
    }

    // ultra HD source
    if (info.width >= 1920) {
      width -= 80;
    }

    // vertical video boost
    if (info.height > info.width) {
      width -= 40;
    }

    width = Math.max(width, 320);

    /* ===================== AUTO FIT ===================== */

    let success = false;

    for (let i = 0; i < 7; i++) {

      safeDelete(output);
      safeDelete(palette);

      console.log(
        `Attempt ${i + 1} | ${fps}fps @ ${width}px`
      );

      await progressMessage.edit(
        `Creating GIF...\nAttempt ${i + 1}/7`
      );

      await createGif(
        input,
        output,
        fps,
        width,
        palette
      );

      if (!fs.existsSync(output)) {
        continue;
      }

      const size =
        getFileSizeMB(output);

      console.log(
        `GIF size: ${size.toFixed(2)}MB`
      );

      if (size <= DISCORD_LIMIT_MB) {
        success = true;
        break;
      }

      // intelligent scaling
      width -= 60;

      if (fps > 10) {
        fps -= 2;
      }

      width = Math.max(width, 280);
    }

    /* ===================== RESULT ===================== */

    if (!success) {

      await progressMessage.edit(
        "Video is too large for Discord GIF limits."
      );

      return;
    }

    await progressMessage.edit(
      "Uploading GIF..."
    );

    await message.reply({
      files: [output],
    });

    await progressMessage.delete().catch(() => {});

    console.log(
      "GIF sent successfully"
    );

  } catch (err) {

    console.error(err);

    try {
      await message.reply(
        "Conversion failed."
      );
    } catch {}

  } finally {

    safeDelete(input);
    safeDelete(output);
    safeDelete(palette);

  }

});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
