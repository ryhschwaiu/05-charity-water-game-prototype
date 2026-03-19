const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const startOverlay = document.getElementById('startOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const pauseOverlay = document.getElementById('pauseOverlay');
const startButton = document.getElementById('startButton');
const restartButton = document.getElementById('restartButton');
const pauseButton = document.getElementById('pauseButton');
const continueButton = document.getElementById('continueButton');
const pauseRestartButton = document.getElementById('pauseRestartButton');
const quitButton = document.getElementById('quitButton');

// Score Elements & Game Over Message
const scoreValue = document.getElementById('scoreValue');
const finalScoreValue = document.getElementById('finalScoreValue');
const highScoreValue = document.getElementById('highScoreValue');
const gameOverMessage = document.getElementById('gameOverMessage');

// Game Constants
const GRID_COLS = 3;
const TILE_SIZE = 120;
const VISIBLE_ROWS = 6;
const SCROLL_TRIGGER_ROW_OFFSET = VISIBLE_ROWS - 2;
const HAZARDS = ['hatch', 'contaminant', 'pest'];

// Starting parameters
const BASE_WATER_SPEED = 1.0;
const START_PLAYER_ROW = 0;
const START_PLAYER_COL = 0;

canvas.width = GRID_COLS * TILE_SIZE;
canvas.height = VISIBLE_ROWS * TILE_SIZE;

let waterLevel = -3;
let score = 0;
let highScore = Number(localStorage.getItem('openTheFlowHighScore') || 0);
highScoreValue.textContent = `${highScore}`;

let waterSpeed = BASE_WATER_SPEED;
let guaranteedPathCol = START_PLAYER_COL;
let generationCount = 0;

const colors = {
	pipe: '#8BD1CB',
	empty: '#e9f4f9',
	player: '#FFC907',
	water: '#2E9DF7',
	hatch: '#FF902A',
	contaminant: '#F5402C',
	pest: '#F16061',
	text: '#17334a'
};

// Game State Variables
let rows = [];
let worldTopRow = 0;
let animationId = null;
let lastTime = 0;
let gameState = 'start';

// Player State
let player = {
	row: START_PLAYER_ROW,
	col: START_PLAYER_COL,
	moveCooldown: 0
};

function makeTile(type, hazard = null, state = null) {
	return { type, hazard, state };
}

function generateRow(depth = 0, requiredCol = START_PLAYER_COL) {
	const row = [makeTile('empty'), makeTile('empty'), makeTile('empty')];
	let nextRequiredCol = requiredCol;

	row[requiredCol] = makeTile('pipe');

	for (let col = 0; col < GRID_COLS; col += 1) {
		if (col !== requiredCol && Math.random() < 0.35) {
			row[col].type = 'pipe';
		}
	}

	if (Math.random() < 0.28) {
		const direction = Math.random() < 0.5 ? -1 : 1;
		const shiftedCol = requiredCol + direction;
		if (shiftedCol >= 0 && shiftedCol < GRID_COLS) {
			row[shiftedCol].type = 'pipe';
			nextRequiredCol = shiftedCol;
		}
	}

	return { row, nextRequiredCol };
}

function isTileWalkable(tile) {
	return Boolean(tile && (tile.type === 'pipe' || tile.hazard === 'pest'));
}

function getSideFromTo(fromRow, fromCol, toRow, toCol) {
	// This tells us which side of the target tile the player is coming from.
	if (fromRow === toRow - 1 && fromCol === toCol) {
		return 'top';
	}

	if (fromRow === toRow + 1 && fromCol === toCol) {
		return 'bottom';
	}

	if (fromCol === toCol - 1 && fromRow === toRow) {
		return 'left';
	}

	if (fromCol === toCol + 1 && fromRow === toRow) {
		return 'right';
	}

	return null;
}

function getConnectedPipeSides(rowIndex, colIndex) {
	// We only count neighboring pipe tiles (up/right/down/left).
	const connectedSides = [];

	const neighbors = [
		{ side: 'top', row: rowIndex - 1, col: colIndex },
		{ side: 'right', row: rowIndex, col: colIndex + 1 },
		{ side: 'bottom', row: rowIndex + 1, col: colIndex },
		{ side: 'left', row: rowIndex, col: colIndex - 1 }
	];

	for (const neighbor of neighbors) {
		const neighborTile = getTileAtWorld(neighbor.row, neighbor.col);
		if (neighborTile && neighborTile.type === 'pipe') {
			connectedSides.push(neighbor.side);
		}
	}

	return connectedSides;
}

function isTileAdjacentToPipe(rowIndex, colIndex) {
	return getConnectedPipeSides(rowIndex, colIndex).length > 0;
}

function canGenerateHatchAt(rowIndex, colIndex) {
	const tile = getTileAtWorld(rowIndex, colIndex);
	if (!tile || tile.type !== 'pipe') {
		return false;
	}

	const connectedSides = getConnectedPipeSides(rowIndex, colIndex);
	// Hatch rule: it only makes sense when exactly 2 connections exist.
	return connectedSides.length === 2;
}

function maybeAddHazardToRow(rowIndex, depth = 0) {
	if (rowIndex === START_PLAYER_ROW) {
		return;
	}

	const hazardChance = Math.min(0.2 + depth * 0.005, 0.5);
	if (Math.random() >= hazardChance) {
		return;
	}

	const randomHazard = HAZARDS[Math.floor(Math.random() * HAZARDS.length)];

	const hazardCandidates = [];
	for (let col = 0; col < GRID_COLS; col += 1) {
		const tile = getTileAtWorld(rowIndex, col);
		if (!tile || tile.hazard) {
			continue;
		}

		if (randomHazard === 'pest') {
			if (tile.type !== 'pipe' && isTileAdjacentToPipe(rowIndex, col)) {
				hazardCandidates.push(col);
			}
			continue;
		}

		if (tile.type === 'pipe') {
			hazardCandidates.push(col);
		}
	}

	if (hazardCandidates.length === 0) {
		return;
	}

	const randomIndex = Math.floor(Math.random() * hazardCandidates.length);
	const hazardCol = hazardCandidates[randomIndex];
	const targetTile = getTileAtWorld(rowIndex, hazardCol);

	if (!targetTile) {
		return;
	}

	if (randomHazard === 'hatch') {
		if (!canGenerateHatchAt(rowIndex, hazardCol)) {
			// If the tile is not a 2-connection path tile, skip hatch placement.
			return;
		}

		targetTile.hazard = 'hatch';
		targetTile.state = 'closed';
		targetTile.openSide = null;
		return;
	}

	targetTile.hazard = randomHazard;
}

function getTileAtWorld(rowIndex, colIndex) {
	if (rowIndex < worldTopRow || rowIndex >= worldTopRow + rows.length) {
		return null;
	}

	const localIndex = rowIndex - worldTopRow;
	const row = rows[localIndex];
	if (!row) {
		return null;
	}

	return row[colIndex] || null;
}

function isValidMove(fromRow, fromCol, targetRow, targetCol) {
	if (targetCol < 0 || targetCol >= GRID_COLS) {
		return false;
	}

	const isAdjacentMove =
		Math.abs(targetRow - fromRow) + Math.abs(targetCol - fromCol) === 1;
	if (!isAdjacentMove) {
		return false;
	}

	const currentTile = getTileAtWorld(fromRow, fromCol);
	if (currentTile && currentTile.hazard === 'hatch' && currentTile.state === 'closed') {
		// Closed hatch: you can only leave using the hatch's open side.
		const leavingSide = getSideFromTo(targetRow, targetCol, fromRow, fromCol);
		if (!currentTile.openSide || leavingSide !== currentTile.openSide) {
			return false;
		}
	}

	const tile = getTileAtWorld(targetRow, targetCol);
	if (!isTileWalkable(tile)) {
		return false;
	}

	if (tile.hazard === 'hatch' && tile.state === 'closed') {
		// Closed hatch: first approach sets the allowed entry side.
		const entrySide = getSideFromTo(fromRow, fromCol, targetRow, targetCol);
		const connectedSides = getConnectedPipeSides(targetRow, targetCol);

		if (!connectedSides.includes(entrySide)) {
			return false;
		}

		if (tile.openSide && tile.openSide !== entrySide) {
			return false;
		}
	}

	return true;
}

function scrollWorldDownOneTile() {
	worldTopRow += 1;
	rows.shift();

	const nextDepth = generationCount;
	const nextRowData = generateRow(nextDepth, guaranteedPathCol);
	rows.push(nextRowData.row);

	// Add hazards to the second-to-last row, because it now has known neighbors above and below. This keeps hatch adjacency checks accurate.
	const eligibleHazardRow = worldTopRow + rows.length - 2;
	if (eligibleHazardRow >= worldTopRow) {
		maybeAddHazardToRow(eligibleHazardRow, Math.max(0, nextDepth - 1));
	}

	guaranteedPathCol = nextRowData.nextRequiredCol;
	generationCount += 1;
}

function applyPlayerTriggeredScroll() {
	const triggerRow = worldTopRow + SCROLL_TRIGGER_ROW_OFFSET;

	if (player.row < triggerRow) {
		return;
	}

	// Scroll one tile at a time when player reaches the trigger line.
	scrollWorldDownOneTile();
}

function handleInput(event) {
	if (event.key === 'Escape') {
		event.preventDefault();
		if (gameState === 'playing') {
			pauseGame();
		} else if (gameState === 'paused') {
			continueGame();
		}
		return;
	}

	if (gameState !== 'playing') {
		return;
	}

	const key = event.key;

	if (key === ' ' || key === 'Spacebar') {
		event.preventDefault();
		interactWithCurrentTile();
		return;
	}

	if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
		return;
	}

	event.preventDefault();

	if (player.moveCooldown > 0) {
		return;
	}

	const nextPosition = { row: player.row, col: player.col };

	if (key === 'ArrowLeft') {
		nextPosition.col -= 1;
	} else if (key === 'ArrowRight') {
		nextPosition.col += 1;
	} else if (key === 'ArrowUp') {
		nextPosition.row -= 1;
	} else if (key === 'ArrowDown') {
		nextPosition.row += 1;
	}

	if (isValidMove(player.row, player.col, nextPosition.row, nextPosition.col)) {
		const previousRow = player.row;
		const previousCol = player.col;

		player.row = nextPosition.row;
		player.col = nextPosition.col;

		const currentTile = getTileAtWorld(player.row, player.col);
		if (currentTile && currentTile.hazard === 'pest') {
			endGame('A pest got you.');
			return;
		}

		const progress = Math.max(0, player.row - START_PLAYER_ROW);
		if (progress > score) {
			score = progress;
			scoreValue.textContent = `${score}`;
		}

		applyPlayerTriggeredScroll();

		if (currentTile && currentTile.hazard === 'hatch' && currentTile.state === 'closed' && !currentTile.openSide) {
			currentTile.openSide = getSideFromTo(previousRow, previousCol, player.row, player.col);
		}

		player.moveCooldown = 0.12;
	}
}

function interactWithCurrentTile() {
	const tile = getTileAtWorld(player.row, player.col);
	if (!tile || tile.type !== 'pipe') {
		return;
	}

	if (tile.hazard === 'hatch' && tile.state === 'closed') {
		tile.state = 'open';
		tile.openSide = null;
		return;
	}

	if (tile.hazard === 'contaminant') {
		tile.hazard = null;
		tile.state = null;
	}
}

function checkCollisions() {
	const visibleBottomRow = worldTopRow + rows.length - 1;
	if (player.row < worldTopRow || player.row > visibleBottomRow) {
		endGame('You scrolled off screen.');
		return;
	}

	if (waterLevel >= player.row) {
		endGame('The water reached the player.');
		return;
	}

	const maxDangerRow = Math.floor(waterLevel);
	for (let rowIndex = worldTopRow; rowIndex <= maxDangerRow; rowIndex += 1) {
		for (let col = 0; col < GRID_COLS; col += 1) {
			const tile = getTileAtWorld(rowIndex, col);
			if (!tile) {
				continue;
			}

			const isDangerous = tile.hazard === 'contaminant';
			if (isDangerous) {
				endGame('Water hit contamination. Flow is unsafe.');
				return;
			}
		}
	}
}

function updateGame(deltaTime) {
	if (gameState !== 'playing') {
		return;
	}

	const difficulty = Math.floor(score / 10);
	waterSpeed = BASE_WATER_SPEED + difficulty * 0.025;

	if (player.moveCooldown > 0) {
		player.moveCooldown = Math.max(0, player.moveCooldown - deltaTime);
	}

	waterLevel += waterSpeed * deltaTime;

	checkCollisions();
}

function drawTileVisual(tile, x, y) {
	// Pest lives on non-pipe tiles, but we tint that whole tile like a pipe.
	const shouldUsePipeBackground = tile.type === 'pipe' || tile.hazard === 'pest';
	ctx.fillStyle = shouldUsePipeBackground ? colors.pipe : colors.empty;
	ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

	ctx.strokeStyle = '#d4e8f2';
	ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);

	if (!tile.hazard) {
		return;
	}

	let label = '';
	let color = colors.text;

	if (tile.hazard === 'hatch') {
		label = tile.state === 'open' ? 'Hatch Open' : 'Hatch';
		color = colors.hatch;
	} else if (tile.hazard === 'contaminant') {
		label = 'Contam';
		color = colors.contaminant;
	} else if (tile.hazard === 'pest') {
		label = 'Pest';
		color = colors.pest;
	}

	ctx.fillStyle = color;
	ctx.fillRect(x + 22, y + 44, TILE_SIZE - 44, 30);

	ctx.fillStyle = '#ffffff';
	ctx.font = '12px Arial';
	ctx.textAlign = 'center';
	ctx.fillText(label, x + TILE_SIZE / 2, y + 63);
}

function drawGame() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	for (let localRow = 0; localRow < rows.length; localRow += 1) {
		const row = rows[localRow];
		const worldRow = worldTopRow + localRow;
		const screenY = (worldRow - worldTopRow) * TILE_SIZE;

		if (screenY > canvas.height || screenY < -TILE_SIZE) {
			continue;
		}

		for (let col = 0; col < GRID_COLS; col += 1) {
			const x = col * TILE_SIZE;
			drawTileVisual(row[col], x, screenY);
		}
	}

	const playerY = (player.row - worldTopRow) * TILE_SIZE + 24;
	const playerX = player.col * TILE_SIZE + 24;
	ctx.fillStyle = colors.player;
	ctx.fillRect(playerX, playerY, TILE_SIZE - 48, TILE_SIZE - 48);

	const waterScreenY = (waterLevel - worldTopRow) * TILE_SIZE;
	const clampedWaterY = Math.max(0, Math.min(canvas.height, waterScreenY));
	ctx.fillStyle = 'rgba(46, 157, 247, 0.35)';
	ctx.fillRect(0, 0, canvas.width, clampedWaterY);

	ctx.strokeStyle = colors.water;
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.moveTo(0, clampedWaterY);
	ctx.lineTo(canvas.width, clampedWaterY);
	ctx.stroke();
}

function endGame(reason) {
	if (gameState !== 'playing') {
		return;
	}

	gameState = 'game-over';
	cancelAnimationFrame(animationId);

	finalScoreValue.textContent = `${score}`;
	gameOverMessage.textContent = reason;

	if (score > highScore) {
		highScore = score;
		highScoreValue.textContent = `${highScore}`;
		localStorage.setItem('openTheFlowHighScore', `${highScore}`);
	}

	pauseOverlay.classList.remove('show');
	gameOverOverlay.classList.add('show');
}

function pauseGame() {
	if (gameState !== 'playing') {
		return;
	}

	gameState = 'paused';
	cancelAnimationFrame(animationId);
	pauseOverlay.classList.add('show');
}

function continueGame() {
	if (gameState !== 'paused') {
		return;
	}

	gameState = 'playing';
	lastTime = 0;
	pauseOverlay.classList.remove('show');
	animationId = requestAnimationFrame(gameLoop);
}

function restartFromPause() {
	if (gameState !== 'paused') {
		return;
	}

	pauseOverlay.classList.remove('show');
	startGame();
}

function quitToMainMenu() {
	if (gameState !== 'paused') {
		return;
	}

	gameState = 'start';
	cancelAnimationFrame(animationId);
	setupNewGame();
	drawGame();
	pauseOverlay.classList.remove('show');
	gameOverOverlay.classList.remove('show');
	startOverlay.classList.add('show');
}

function setupNewGame() {
	rows = [];
	worldTopRow = 0;
	generationCount = 0;
	guaranteedPathCol = START_PLAYER_COL;
	score = 0;
	scoreValue.textContent = '0';

	player = {
		row: START_PLAYER_ROW,
		col: START_PLAYER_COL,
		moveCooldown: 0
	};

	waterLevel = -3;
	waterSpeed = BASE_WATER_SPEED;

	for (let i = 0; i < VISIBLE_ROWS; i += 1) {
		const rowData = generateRow(generationCount, guaranteedPathCol);
		rows.push(rowData.row);
		guaranteedPathCol = rowData.nextRequiredCol;
		generationCount += 1;
	}

	// Now that the initial board is built, place hazards only on rows that have
	// both a row above and below so hatch adjacency checks use complete context.
	for (let localRow = 1; localRow < rows.length - 1; localRow += 1) {
		const rowIndex = worldTopRow + localRow;
		maybeAddHazardToRow(rowIndex, localRow);
	}

	const spawnTile = getTileAtWorld(player.row, player.col);
	if (!isTileWalkable(spawnTile)) {
		const localRow = player.row - worldTopRow;
		rows[localRow][player.col] = makeTile('pipe');
	}
}

function gameLoop(timestamp) {
	if (!lastTime) {
		lastTime = timestamp;
	}

	const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.1);
	lastTime = timestamp;

	updateGame(deltaTime);
	drawGame();

	if (gameState === 'playing') {
		animationId = requestAnimationFrame(gameLoop);
	}
}

function startGame() {
	setupNewGame();
	gameState = 'playing';
	lastTime = 0;
	startOverlay.classList.remove('show');
	gameOverOverlay.classList.remove('show');
	pauseOverlay.classList.remove('show');
	animationId = requestAnimationFrame(gameLoop);
}

startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', startGame);
pauseButton.addEventListener('click', pauseGame);
continueButton.addEventListener('click', continueGame);
pauseRestartButton.addEventListener('click', restartFromPause);
quitButton.addEventListener('click', quitToMainMenu);
window.addEventListener('keydown', handleInput);

drawGame();
