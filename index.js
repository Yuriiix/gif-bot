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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const attachment = message.attachments.first();
  if (!attachment) return;

  if (!attachment.contentType?.startsWith('video/')) return;

  await message.reply('Converting video...');

  const input = './input.mp4';
  const output = './output.gif';

  const response = await axios({
    url: attachment.url,
    method: 'GET',
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(input);

  response.data.pipe(writer);

  writer.on('finish', () => {
    ffmpeg(input)
      .outputOptions([
        '-vf',
        'fps=10,scale=320:-1:flags=lanczos'
      ])
      .save(output)
      .on('end', async () => {
        await message.reply({
          files: [output]
        });

        fs.unlinkSync(input);
        fs.unlinkSync(output);
      });
  });
});

client.login(TOKEN);