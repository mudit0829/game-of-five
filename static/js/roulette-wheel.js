const wheel = document.getElementById("rouletteWheel");
const pocketsEl = document.getElementById("wheelPockets");

/* European roulette order */
const rouletteNumbers = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34,
  6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31,
  9, 22, 18, 29, 7, 28, 12,
  35, 3, 26
];

const redNumbers = [
  1,3,5,7,9,12,14,16,18,19,
  21,23,25,27,30,32,34,36
];

const sliceAngle = 360 / rouletteNumbers.length;

/* Build pockets */
rouletteNumbers.forEach((num, i) => {
  const pocket = document.createElement("div");
  pocket.className = "pocket";

  let color = "black";
  if (num === 0) color = "green";
  else if (redNumbers.includes(num)) color = "red";

  pocket.classList.add(color);
  pocket.style.transform =
    `rotate(${i * sliceAngle}deg) translate(-100%, -100%)`;

  pocket.innerHTML = `<span>${num}</span>`;
  pocketsEl.appendChild(pocket);
});

/* Demo spin (for testing alignment) */
window.spinDemo = function (winningNumber = 0) {
  const index = rouletteNumbers.indexOf(winningNumber);
  const stopAngle = 360 - index * sliceAngle;
  const spins = 6 * 360;

  wheel.style.transform =
    `rotate(${spins + stopAngle}deg)`;
};
