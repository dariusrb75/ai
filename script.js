const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const lengthEl = document.getElementById('length');
const speedEl = document.getElementById('speed');
const restartBtn = document.getElementById('restart');

const palette = ['#ff8ec7', '#7f7fff', '#54e0ff', '#7cf585', '#ffe066', '#f48b29'];
const input = { up: false, down: false, left: false, right: false, boost: false };

const game = {
  player: null,
  orbs: [],
  world: { width: canvas.width, height: canvas.height },
  lastTime: 0,
  running: false
};

function createPlayer() {
  const start = { x: canvas.width / 2, y: canvas.height / 2 };
  return {
    segments: Array.from({ length: 80 }, () => ({ x: start.x, y: start.y })),
    direction: { x: 1, y: 0 },
    targetLength: 90,
    speed: 2.8,
    score: 0,
    alive: true,
    colorShift: 0,
    boostMeter: 1
  };
}

function randomColor() {
  return palette[Math.floor(Math.random() * palette.length)];
}

function spawnOrb() {
  const margin = 24;
  game.orbs.push({
    x: margin + Math.random() * (game.world.width - margin * 2),
    y: margin + Math.random() * (game.world.height - margin * 2),
    color: randomColor(),
    value: 15 + Math.floor(Math.random() * 10)
  });
}

function spawnOrbsIfNeeded() {
  const desired = 16;
  while (game.orbs.length < desired) {
    spawnOrb();
  }
}

function resetGame() {
  game.player = createPlayer();
  game.orbs = [];
  game.lastTime = performance.now();
  game.running = true;
  for (let i = 0; i < 12; i += 1) {
    spawnOrb();
  }
  updateHUD();
}

function handleInput() {
  const axisX = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  const axisY = (input.up ? -1 : 0) + (input.down ? 1 : 0);

  if (axisX === 0 && axisY === 0) return;

  const length = Math.hypot(axisX, axisY) || 1;
  game.player.direction.x = axisX / length;
  game.player.direction.y = axisY / length;
}

function updatePlayer(dt) {
  const player = game.player;
  if (!player.alive) return;

  handleInput();

  const baseSpeed = input.boost && player.targetLength > 60 ? player.speed * 1.55 : player.speed;
  const dx = player.direction.x * baseSpeed;
  const dy = player.direction.y * baseSpeed;

  const newHead = {
    x: player.segments[0].x + dx,
    y: player.segments[0].y + dy
  };

  // Wall bounce
  if (newHead.x < 8 || newHead.x > game.world.width - 8) {
    game.player.direction.x *= -1;
    newHead.x = Math.max(8, Math.min(game.world.width - 8, newHead.x));
  }
  if (newHead.y < 8 || newHead.y > game.world.height - 8) {
    game.player.direction.y *= -1;
    newHead.y = Math.max(8, Math.min(game.world.height - 8, newHead.y));
  }

  player.segments.unshift(newHead);

  if (input.boost && player.targetLength > 60) {
    player.targetLength -= 0.25;
    player.boostMeter = Math.max(0, player.boostMeter - dt * 0.25);
  } else {
    player.boostMeter = Math.min(1, player.boostMeter + dt * 0.2);
  }

  while (player.segments.length > player.targetLength) {
    player.segments.pop();
  }
}

function eatOrbs() {
  const player = game.player;
  const head = player.segments[0];

  for (let i = game.orbs.length - 1; i >= 0; i -= 1) {
    const orb = game.orbs[i];
    const dist = Math.hypot(head.x - orb.x, head.y - orb.y);
    if (dist < 16) {
      player.targetLength += orb.value;
      player.score += 10 + orb.value;
      game.orbs.splice(i, 1);
    }
  }
}

function checkSelfCollision() {
  const head = game.player.segments[0];
  for (let i = 12; i < game.player.segments.length; i += 1) {
    const segment = game.player.segments[i];
    if (Math.hypot(head.x - segment.x, head.y - segment.y) < 10) {
      game.player.alive = false;
      game.running = false;
      return;
    }
  }
}

function drawGlowCircle(x, y, radius, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSnake() {
  const player = game.player;
  const head = player.segments[0];

  for (let i = player.segments.length - 1; i >= 0; i -= 1) {
    const segment = player.segments[i];
    const t = i / player.segments.length;
    const hue = (player.colorShift + t * 280) % 360;
    const color = `hsl(${hue}, 95%, ${55 - t * 20}%)`;
    drawGlowCircle(segment.x, segment.y, Math.max(7, 11 - t * 4), color);
  }

  // Eyes
  const eyeOffset = 6;
  const nx = player.direction.x || 1;
  const ny = player.direction.y || 0;
  drawGlowCircle(head.x + ny * eyeOffset, head.y - nx * eyeOffset, 3, '#fefefe');
  drawGlowCircle(head.x - ny * eyeOffset, head.y + nx * eyeOffset, 3, '#fefefe');

  player.colorShift = (player.colorShift + 40 * (1 / 60)) % 360;
}

function drawOrbs() {
  for (const orb of game.orbs) {
    drawGlowCircle(orb.x, orb.y, 8, orb.color);
  }
}

function drawBackground() {
  ctx.fillStyle = '#040712';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  const grid = 80;
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += grid) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for (let y = 0; y <= canvas.height; y += grid) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();
}

function updateHUD() {
  scoreEl.textContent = Math.floor(game.player.score).toString();
  lengthEl.textContent = Math.floor(game.player.targetLength).toString();
  speedEl.textContent = game.player.alive ? game.player.speed.toFixed(2) : '0';
}

function drawGameOver() {
  ctx.save();
  ctx.fillStyle = 'rgba(4, 7, 18, 0.8)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8ecff';
  ctx.font = 'bold 42px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Collision !', canvas.width / 2, canvas.height / 2 - 10);
  ctx.font = '20px "Inter", sans-serif';
  ctx.fillText('Appuyez sur R ou sur Recommencer pour rejouer', canvas.width / 2, canvas.height / 2 + 26);
  ctx.restore();
}

function frame(time) {
  const dt = Math.min((time - game.lastTime) / 1000, 0.05);
  game.lastTime = time;

  updatePlayer(dt);
  eatOrbs();
  spawnOrbsIfNeeded();
  checkSelfCollision();
  updateHUD();

  drawBackground();
  drawOrbs();
  drawSnake();

  if (!game.player.alive) {
    drawGameOver();
    return;
  }

  if (game.running) {
    requestAnimationFrame(frame);
  }
}

function startLoop() {
  game.lastTime = performance.now();
  requestAnimationFrame(frame);
}

function setupEvents() {
  const keyMap = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    z: 'up',
    s: 'down',
    q: 'left',
    d: 'right'
  };

  window.addEventListener('keydown', (e) => {
    const key = keyMap[e.key];
    if (key) {
      input[key] = true;
    }
    if (e.key === ' ') input.boost = true;
    if (e.key === 'r' || e.key === 'R') resetGame();
  });

  window.addEventListener('keyup', (e) => {
    const key = keyMap[e.key];
    if (key) {
      input[key] = false;
    }
    if (e.key === ' ') input.boost = false;
  });

  restartBtn.addEventListener('click', resetGame);
}

function init() {
  setupEvents();
  resetGame();
  startLoop();
}

init();
