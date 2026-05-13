const express = require("express");
const app = express();

const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TOKEN = process.env.TOKEN;

/* ===================== READY EVENT ===================== */
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ===================== MESSAGE EVENT ===================== */
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const attachment = message.attachments.first();
  if (!attachment) return;

  if (!attachment.contentType?.startsWith('video/')) return;

  await message.reply('Converting video...');

  const id = Date.now();

  const input = `./input-${id}.mp4`;
  const output = `./output-${id}.gif`;

  /* ===================== DOWNLOAD VIDEO ===================== */
  const response = await axios({
    url: attachment.url,
    method: 'GET',
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(input);

  writer.on('error', (err) => {
    console.log("Download error:", err);
  });

  writer.on('finish', () => {

    /* ===================== CONVERT TO GIF ===================== */
    ffmpeg(input)
      .outputOptions([
        '-vf',
        'fps=10,scale=320:-1:flags=lanczos'
      ])
      .save(output)
      .on('end', async () => {
        try {
          await message.reply({ files: [output] });
        } catch (err) {
          console.log(err);
        }

        fs.unlinkSync(input);
        fs.unlinkSync(output);
      })
      .on('error', (err) => {
        console.log("FFmpeg error:", err);
      });
  });

  response.data.pipe(writer);
});

/* ===================== EXPRESS SERVER (RENDER FIX) ===================== */
app.get("/", (req, res) => {
  res.send("Bot is alive");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== LOGIN ===================== */
client.login(TOKEN);
