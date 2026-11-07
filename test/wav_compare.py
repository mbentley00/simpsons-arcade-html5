# Compare two 16-bit stereo WAVs sample by sample (ours vs MAME -wavwrite): max/RMS difference and correlation.
import numpy as np, sys, wave
def rd(p):
    w = wave.open(p); return np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2).astype(np.int32)
a, b = rd(sys.argv[1]), rd(sys.argv[2]); n = min(len(a), len(b)); d = a[:n] - b[:n]
print('samples', n, '(%.2f s)' % (n / wave.open(sys.argv[1]).getframerate()), 'max |diff|', np.abs(d).max(), 'rms diff %.3f' % np.sqrt((d.astype(float) ** 2).mean()),
      'rms mame %.1f' % np.sqrt((b[:n].astype(float) ** 2).mean()), 'exact samples %.4f%%' % (100 * (d == 0).all(1).mean()))
