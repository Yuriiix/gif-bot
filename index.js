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

app.get("/", (_, res) => res.send("Bot alive"));

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== READY ===================== */

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== SETTINGS ===================== */

const MAX_MB = 7.5; // Discord safe limit

/* ===================== MESSAGE ===================== */

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  const file = message.attachments.first();

  if (!file) return;

  // accept any video type
  if (!file.contentType?.startsWith("video/")) return;

  const id = Date.now();
  const input = `input-${id}.mp4`;
  const output = `output-${id}.gif`;

  try {

    await message.reply("Converting video to GIF...");

    /* ===================== DOWNLOAD ===================== */

    const res = await axios({
      url: file.url,
      method: "GET",
      responseType: "stream",
    });

    const writer = fs.createWriteStream(input);
    res.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    /* ===================== CONVERT (FAST + CLEAN) ===================== */

    await new Promise((resolve, reject) => {

      ffmpeg(input)

        .outputOptions([
          // quality + speed balance
          "-vf",
          "fps=15,scale=540:-1:flags=lanczos",

          // keep looping GIF
          "-loop", "0",

          // faster encoding
          "-preset", "veryfast",
          "-threads", "2",
        ])

        .format("gif")
        .save(output)

        .on("end", resolve)
        .on("error", reject);

    });

    /* ===================== SIZE CHECK ===================== */

    const sizeMB =
      fs.statSync(output).size / 1024 / 1024;

    if (sizeMB > MAX_MB) {

      // fallback: lower quality automatically once
      fs.unlinkSync(output);

      await new Promise((resolve, reject) => {

        ffmpeg(input)

          .outputOptions([
            "-vf",
            "fps=12,scale=420:-1:flags=lanczos",
            "-loop", "0",
            "-preset", "veryfast",
            "-threads", "2",
          ])

          .format("gif")
          .save(output)

          .on("end", resolve)
          .on("error", reject);

      });
    }

    /* ===================== SEND ===================== */

    await message.reply({
      files: [output],
    });

  } catch (err) {

    console.error(err);
    await message.reply("Failed to convert video.");

  } finally {

    if (fs.existsSync(input)) fs.unlinkSync(input);
    if (fs.existsSync(output)) fs.unlinkSync(output);

  }

});

/* ===================== LOGIN ===================== */

client.login(TOKEN);
