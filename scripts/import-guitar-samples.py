"""Fetch and convert the small CC0 Parker Fly guitar sample subset for AstraBoard."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = REPO_ROOT / "public" / "audio" / "guitar"
SOURCE = "cluesurf/wavebase"
SOURCE_REVISION = "0c7183fd66fb68e5343d37f2eeebdf40cc7c570e"
FRETS = (0, 2, 6, 12, 18, 24)
ROUND_ROBINS = (1, 2)
DROP_D_OPEN_MIDI = {6: 38, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64}
NOTE_NAMES = ("C", "Cx", "D", "Dx", "E", "F", "Fx", "G", "Gx", "A", "Ax", "B")


def source_filename(string_number, fret, round_robin):
    midi = DROP_D_OPEN_MIDI[string_number] + fret
    note = f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"
    return f"string-{string_number}-note-{note}-fret-{fret:02d}-{round_robin}.wav"


def download_and_convert(string_number, fret, round_robin):
    filename = source_filename(string_number, fret, round_robin)
    relative = f"base/guitar/parker-fly/string-{string_number}/{filename}"
    url = f"https://media.githubusercontent.com/media/{SOURCE}/{SOURCE_REVISION}/{relative}"
    output = OUTPUT_DIR / f"s{string_number}-f{fret}-r{round_robin}.mp3"
    request = urllib.request.Request(url, headers={"User-Agent": "AstraBoard sample importer"})

    with tempfile.TemporaryDirectory(prefix="astraboard-guitar-") as scratch:
        wav_path = Path(scratch) / "source.wav"
        with urllib.request.urlopen(request, timeout=90) as response, wav_path.open("wb") as wav_file:
            shutil.copyfileobj(response, wav_file)

        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(wav_path),
                "-map_metadata",
                "-1",
                "-vn",
                "-ar",
                "44100",
                "-ac",
                "2",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "2",
                "-write_xing",
                "0",
                str(output),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

    return output


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    jobs = [(string, fret, rr) for string in range(1, 7) for fret in FRETS for rr in ROUND_ROBINS]
    total_bytes = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(download_and_convert, *job): job for job in jobs}
        for completed, future in enumerate(as_completed(pending), start=1):
            job = pending[future]
            try:
                output = future.result()
            except Exception as error:
                raise RuntimeError(f"Unable to import string {job[0]}, fret {job[1]}, take {job[2]}") from error
            total_bytes += output.stat().st_size
            if completed % 12 == 0 or completed == len(jobs):
                print(f"Converted {completed}/{len(jobs)} guitar samples ({total_bytes / 1024 / 1024:.1f} MiB).", flush=True)

    print(f"Wrote {len(jobs)} samples to {OUTPUT_DIR} ({total_bytes / 1024 / 1024:.1f} MiB).")


if __name__ == "__main__":
    main()
