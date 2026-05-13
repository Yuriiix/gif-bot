function makeGif(input, output, fps, width) {

  const palette = `palette-${Date.now()}.png`;

  return new Promise((resolve, reject) => {

    /* ---------- CREATE PALETTE ---------- */

    ffmpeg(input)

      .outputOptions([
        "-vf",
        `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=max_colors=256`
      ])

      .save(palette)

      .on("end", () => {

        /* ---------- CREATE GIF ---------- */

        const command = ffmpeg(input)

          .input(palette)

          .complexFilter([
            `fps=${fps},scale=${width}:-1:flags=lanczos[x]`,
            "[x][1:v]paletteuse=dither=bayer:bayer_scale=3"
          ])

          .outputOptions([
            "-loop",
            "0",

            "-gifflags",
            "-offsetting",

            "-threads",
            "2",
          ])

          .outputFormat("gif")

          .on("end", () => {
            clean(palette);
            resolve();
          })

          .on("error", (err) => {
            clean(palette);
            reject(err);
          })

          .save(output);

        /* timeout safety */

        setTimeout(() => {
          try {
            command.kill("SIGKILL");
          } catch {}
        }, 60000);

      })

      .on("error", (err) => {
        clean(palette);
        reject(err);
      });

  });
}
