const wheel = document.getElementById("slices");
const numberGrid = document.getElementById("numberGrid");

/* European Roulette Order */
const numbers = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34,
  6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
  29, 7, 28, 12, 35, 3, 26
];

const sliceAngle = 360 / numbers.length;
const cx = 250;
const cy = 250;
const rOuter = 220;
const rInner = 120;

numbers.forEach((num, i) => {
  const start = i * sliceAngle;
  const end = start + sliceAngle;

  const largeArc = sliceAngle > 180 ? 1 : 0;

  const color =
    num === 0 ? "#2fa64a" :
    i % 2 === 0 ? "#c21c1c" : "#111";

  const path = `
    M ${cx + rInner * Math.cos(Math.PI * start / 180)}
      ${cy + rInner * Math.sin(Math.PI * start / 180)}
    L ${cx + rOuter * Math.cos(Math.PI * start / 180)}
      ${cy + rOuter * Math.sin(Math.PI * start / 180)}
    A ${rOuter} ${rOuter} 0 ${largeArc} 1
      ${cx + rOuter * Math.cos(Math.PI * end / 180)}
      ${cy + rOuter * Math.sin(Math.PI * end / 180)}
    L ${cx + rInner * Math.cos(Math.PI * end / 180)}
      ${cy + rInner * Math.sin(Math.PI * end / 180)}
    A ${rInner} ${rInner} 0 ${largeArc} 0
      ${cx + rInner * Math.cos(Math.PI * start / 180)}
      ${cy + rInner * Math.sin(Math.PI * start / 180)}
  `;

  const slice = document.createElementNS("http://www.w3.org/2000/svg", "path");
  slice.setAttribute("d", path);
  slice.setAttribute("fill", color);
  wheel.appendChild(slice);
});

/* Number buttons */
for (let i = 0; i <= 36; i++) {
  const btn = document.createElement("button");
  btn.textContent = i;
  if (i === 0) btn.classList.add("green");
  numberGrid.appendChild(btn);
}
