const express = require("express");
const app = express();

const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

/* ===================== DISCORD CLIENT ===================== */
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

/* ===================== CONFIG ===================== */
const MAX_SIZE = 7 * 1024 * 1024; // 7MB safety limit

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

  /* ===================== DOWNLOAD ===================== */
  const response = await axios({
    url: attachment.url,
    method: 'GET',
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(input);

  writer.on('error', (err) => {
    console.log("Download error:", err);
  });

  response.data.on('error', (err) => {
    console.log("Stream error:", err);
  });

  response.data.pipe(writer);

  writer.on('finish', async () => {

    /* ===================== BEST START QUALITY ===================== */
    let fps = 22;
    let width = 720;

    const createGif = () => {
      return new Promise((resolve, reject) => {
        ffmpeg(input)
          .outputOptions([
            '-t', '6', // keep fast + stable
            '-vf',
            `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`,
            '-loop',
            '0',
            '-preset',
            'veryfast'
          ])
          .save(output)
          .on('end', resolve)
          .on('error', reject);
      });
    };

    /* ===================== SMART SIZE CONTROL ===================== */
    let attempts = 0;
    const MAX_ATTEMPTS = 4;

    while (attempts < MAX_ATTEMPTS) {
      await createGif();

      const size = fs.statSync(output).size;

      if (size <= MAX_SIZE) break;

      // gradual quality reduction
      if (width > 480) {
        width -= 120;
      } else if (fps > 14) {
        fps -= 2;
      } else {
        break;
      }

      fs.unlinkSync(output);
      attempts++;
    }

    try {
      await message.reply({ files: [output] });
    } catch (err) {
      console.log(err);
    }

    fs.unlinkSync(input);
    fs.unlinkSync(output);
  });
});

/* ===================== EXPRESS ===================== */
app.get("/", (req, res) => {
  res.send("Bot is alive");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running");
});

/* ===================== LOGIN ===================== */
client.login(TOKEN);
