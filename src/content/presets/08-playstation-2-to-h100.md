---
title: PlayStation 2 to H100
order: 8
summary: >-
  The PlayStation 2's Graphics Synthesizer and NVIDIA H100 SXM module: a valid
  70× theoretical memory-bandwidth comparison, kept to one metric, method, and
  scope.
kind: system
records:
  - sony-playstation-2@retail
  - nvidia-h100-sxm@sxm
promoted: false
---

# PlayStation 2 to H100

One comparison in this view is exactly 70×. The PlayStation 2 Graphics
Synthesizer's embedded DRAM is rated at 48 GB/s, and the H100 SXM module's HBM3
is rated at 3.35 TB/s. Both are memory-bandwidth figures at memory scope,
obtained by the theoretical-peak method. The approved derived claim divides the
latter by the former and rounds to the two significant digits supported by the
inputs.

The 70× ratio covers peak transfer rates between each memory and its processing
units. It does not measure console performance against accelerator performance.
The Graphics Synthesizer's 48 GB/s is a maximum across separate frame-buffer,
Z-buffer, and texture ports; one operation uses only part of it. The H100 is an
accelerator that receives work from a host. Both caveats remain attached to the
figures behind the ratio.

Other rows are independent of the 70× result. The PlayStation 2's 32 MiB main
RDRAM and the H100's 80 GiB module memory answer different system questions, and
their floating-point rates describe different processors and workloads. The page
shows those figures when the catalog has them, but it does not combine them into
a measure of graphics, gaming, or general-purpose performance.
