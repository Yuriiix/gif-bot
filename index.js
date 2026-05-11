const express = require("express");
const app = express();

const {
  Client,
  GatewayIntentBits,
} = require("discord.js");

const fs = require("fs");
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

/* ===================== EXPRESS ===================== */

app.get("/", (_, res) => {
  res.send("Bot alive");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== READY ===================== */

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== SETTINGS ===================== */

const DISCORD_LIMIT_MB = 7.8;

/* ===================== HELPERS ===================== */

function deleteFile(path) {
  try {
    if (path && fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {}
}

function getFileSizeMB(path) {
  return fs.statSync(path).size / 1024 / 1024;
}

function getVideoInfo(input) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) return reject(err);

      const stream = data.streams.find(
        s => s.codec_type === "video"
      );

      resolve({
        width: stream.width,
        height: stream.height,
        duration: Number(stream.duration || data.format.duration || 0),
      });
    });
  });
}

/* ===================== GIF ENCODER ===================== */

function createGif(input, output, fps, width) {
  return new Promise((resolve, reject) => {

    const palette = `palette-${Date.now()}.png`;

    ffmpeg(input)
      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=max_colors=256`
      ])
      .save(palette)

      .on("end", () => {

        ffmpeg(input)
          .input(palette)
          .complexFilter([
            `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a`
          ])
          .outputOptions([
            "-loop", "0",

            // faster + cleaner
            "-gifflags", "-offsetting",

            // stability
            "-threads", "2",
          ])
          .format("gif")
          .save(output)

          .on("end", () => {
            deleteFile(palette);
            resolve();
          })

          .on("error", (err) => {
            deleteFile(palette);
            reject(err);
          });

      })

      .on("error", (err) => {
        deleteFile(palette);
        reject(err);
      });

  });
}

/* ===================== MESSAGE EVENT ===================== */

client.on("messageCreate", async (message) => {

  let input = null;
  let output = null;

  try {

    if (message.author.bot) return;

    const attachment = message.attachments.first();

    if (
      !attachment ||
      !attachment.contentType?.startsWith("video/")
    ) {
      return;
    }

    await message.reply(
      "Creating high-quality GIF..."
    );

    const id = Date.now();

    input = `input-${id}.mp4`;
    output = `output-${id}.gif`;

    /* ===================== DOWNLOAD ===================== */

    const response = await axios({
      url: attachment.url,
      method: "GET",
      responseType: "stream",
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024,
    });

    const writer = fs.createWriteStream(input);

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
      response.data.on("error", reject);
    });

    /* ===================== VIDEO INFO ===================== */

    const info = await getVideoInfo(input);

    console.log(info);

    /* ===================== SMART QUALITY ===================== */

    let fps = 20;
    let width = 720;

    // long videos need lower settings
    if (info.duration > 8) {
      fps = 16;
      width = 640;
    }

    if (info.duration > 15) {
      fps = 14;
      width = 560;
    }

    // huge source videos
    if (info.width >= 1920) {
      width -= 80;
    }

    /* ===================== AUTO FIT LOOP ===================== */

    let success = false;

    for (let i = 0; i < 6; i++) {

      deleteFile(output);

      console.log(
        `Trying ${fps}fps @ ${width}px`
      );

      await createGif(
        input,
        output,
        fps,
        width
      );

      if (!fs.existsSync(output)) {
        continue;
      }

      const size = getFileSizeMB(output);

      console.log(
        `GIF Size: ${size.toFixed(2)}MB`
      );

      if (size <= DISCORD_LIMIT_MB) {
        success = true;
        break;
      }

      // shrink intelligently
      width -= 60;

      if (fps > 12) {
        fps -= 2;
      }
    }

    /* ===================== RESULT ===================== */

    if (!success) {

      await message.reply(
        "Video is too large for Discord GIF limits."
      );

      return;
    }

    await message.reply({
      files: [output],
    });

    console.log("GIF sent successfully");

  } catch (err) {

    console.error(err);

    await message.reply(
      "Conversion failed."
    );

  } finally {

    deleteFile(input);
    deleteFile(output);

  }

});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
