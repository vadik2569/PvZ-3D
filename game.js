import * as THREE from 'three';

// --- CONFIGURATION ---
const GRID_ROWS = 5;
const GRID_COLS = 9;
const TILE_SIZE = 10;
const ZOMBIE_SPAWN_RATE = 5000; // ms
const SUN_SPAWN_RATE = 8000; // ms

// --- GAME STATE ---
const state = {
    sun: 50,
    score: 0,
    selectedPlant: 'peashooter',
    isGameOver: false,
    lastTime: 0,
    zombies: [],
    plants: [],
    projectiles: [],
    suns: [],
    grid: {} // key: "x,z" (grid coords), value: plantInstance
};

// --- SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue
scene.fog = new THREE.Fog(0x87CEEB, 20, 150);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 60, 60);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// --- ASSETS / MATERIALS ---
const materials = {
    grassLight: new THREE.MeshStandardMaterial({ color: 0x4caf50 }),
    grassDark: new THREE.MeshStandardMaterial({ color: 0x388e3c }),
    peashooter: new THREE.MeshStandardMaterial({ color: 0x00ff00 }),
    sunflower: new THREE.MeshStandardMaterial({ color: 0xffd700 }),
    wallnut: new THREE.MeshStandardMaterial({ color: 0x8d6e63 }),
    zombieSkin: new THREE.MeshStandardMaterial({ color: 0x6a9f5d }),
    zombieClothes: new THREE.MeshStandardMaterial({ color: 0x5c4033 }),
    pea: new THREE.MeshStandardMaterial({ color: 0x76ff03, emissive: 0x2e7d32 }),
    sun: new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffa000 })
};

// --- CLASSES ---

class Plant {
    constructor(type, gridX, gridZ) {
        this.type = type;
        this.gridX = gridX;
        this.gridZ = gridZ;
        this.mesh = new THREE.Group();
        this.mesh.position.set(
            (gridX - GRID_COLS / 2 + 0.5) * TILE_SIZE,
            0,
            (gridZ - GRID_ROWS / 2 + 0.5) * TILE_SIZE
        );
        this.health = 100;
        this.lastActionTime = 0;
        
        // Geometry construction
        if (type === 'peashooter') {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3), materials.peashooter);
            stem.position.y = 1.5;
            const head = new THREE.Mesh(new THREE.SphereGeometry(1.5), materials.peashooter);
            head.position.y = 3.5;
            const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.5), materials.peashooter);
            snout.rotation.x = Math.PI / 2;
            snout.position.set(0, 3.5, 1.5);
            this.mesh.add(stem, head, snout);
            this.cooldown = 1500;
            this.cost = 100;
        } else if (type === 'sunflower') {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3), materials.peashooter); // green stem
            stem.position.y = 1.5;
            const face = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.5), new THREE.MeshStandardMaterial({color: 0x3e2723})); // brown center
            face.rotation.x = Math.PI / 2;
            face.position.set(0, 3.5, 0.3);
            const petals = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.2), materials.sunflower);
            petals.rotation.x = Math.PI / 2;
            petals.position.set(0, 3.5, 0);
            this.mesh.add(stem, petals, face);
            this.cooldown = 10000;
            this.cost = 50;
            this.health = 50;
        } else if (type === 'wallnut') {
            const body = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 16), materials.wallnut);
            // Squish it a bit
            body.scale.set(1, 1.3, 1);
            body.position.y = 2.5;
            this.mesh.add(body);
            this.health = 400;
            this.cost = 50;
        }

        this.mesh.traverse(obj => { if(obj.isMesh) obj.castShadow = true; });
        scene.add(this.mesh);
    }

    update(time) {
        if (this.type === 'peashooter') {
            if (time - this.lastActionTime > this.cooldown) {
                // Check if zombie in lane
                const laneZombies = state.zombies.filter(z => z.gridZ === this.gridZ && z.mesh.position.x > this.mesh.position.x);
                if (laneZombies.length > 0) {
                    shoot(this.mesh.position.clone().add(new THREE.Vector3(0, 3.5, 2)));
                    this.lastActionTime = time;
                }
            }
        } else if (this.type === 'sunflower') {
             if (time - this.lastActionTime > this.cooldown) {
                spawnSun(this.mesh.position.clone().add(new THREE.Vector3(0, 5, 0)), true);
                this.lastActionTime = time;
            }
        }
    }

    takeDamage(amount) {
        this.health -= amount;
        // Visual feedback
        this.mesh.position.x += (Math.random() - 0.5) * 0.5;
        if (this.health <= 0) {
            scene.remove(this.mesh);
            state.plants = state.plants.filter(p => p !== this);
            delete state.grid[`${this.gridX},${this.gridZ}`];
        }
    }
}

class Zombie {
    constructor(row) {
        this.gridZ = row;
        this.speed = 2.5; // units per second
        this.health = 100;
        this.damage = 10; // per second
        this.mesh = new THREE.Group();
        
        // Spawn at right edge
        this.mesh.position.set(
            (GRID_COLS / 2 + 2) * TILE_SIZE,
            0,
            (row - GRID_ROWS / 2 + 0.5) * TILE_SIZE
        );

        // Body
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3, 1), materials.zombieClothes);
        body.position.y = 3;
        
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), materials.zombieSkin);
        head.position.y = 5.25;

        const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.5, 0.5), materials.zombieClothes);
        leftArm.position.set(1, 3.5, 0);
        leftArm.rotation.z = -Math.PI / 4; // Arms out

        const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.5, 0.5), materials.zombieClothes);
        rightArm.position.set(-1, 3.5, 0);
        rightArm.rotation.z = Math.PI / 4;

        const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, 0.6), materials.zombieClothes);
        leftLeg.position.set(0.5, 1.5, 0);
        const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, 0.6), materials.zombieClothes);
        rightLeg.position.set(-0.5, 1.5, 0);

        this.mesh.add(body, head, leftArm, rightArm, leftLeg, rightLeg);
        this.mesh.traverse(obj => { if(obj.isMesh) obj.castShadow = true; });
        
        scene.add(this.mesh);

        // Animation offset
        this.animOffset = Math.random() * 100;
        this.isEating = false;
        this.lastAttackTime = 0;
    }

    update(delta, time) {
        // Find plant in current cell
         // Map x postion to grid
        const currentGridX = Math.round(this.mesh.position.x / TILE_SIZE - 0.5 + GRID_COLS / 2);
        const plantKey = `${currentGridX},${this.gridZ}`;
        const plant = state.grid[plantKey];

        // Ensure we are actually close enough to eat, not just in the same grid cell vaguely
        const dist = plant ? this.mesh.position.distanceTo(plant.mesh.position) : 999;

        if (plant && dist < 3) {
            this.isEating = true;
            if (time - this.lastAttackTime > 1000) {
                plant.takeDamage(this.damage);
                this.lastAttackTime = time;
            }
        } else {
            this.isEating = false;
            this.mesh.position.x -= this.speed * delta;
        }

        // Wobble Animation
        if (!this.isEating) {
            this.mesh.rotation.z = Math.sin(time * 0.005 + this.animOffset) * 0.1;
            this.mesh.position.y = Math.abs(Math.sin(time * 0.01 + this.animOffset)) * 0.2;
        }

        // Check lose condition
        if (this.mesh.position.x < -(GRID_COLS / 2) * TILE_SIZE - 2) {
            gameOver();
        }
    }

    takeDamage(amount) {
        this.health -= amount;
        // Flash red
        this.mesh.traverse(c => {
             if (c.isMesh) {
                 const oldColor = c.material.color.getHex();
                 c.material.color.setHex(0xff0000);
                 setTimeout(() => c.material.color.setHex(oldColor), 100);
             }
        });

        if (this.health <= 0) {
            scene.remove(this.mesh);
            state.zombies = state.zombies.filter(z => z !== this);
            state.score += 10;
            updateUI();
        }
    }
}

class Projectile {
    constructor(position) {
        this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4), materials.pea);
        this.mesh.position.copy(position);
        this.speed = 20;
        this.damage = 25;
        scene.add(this.mesh);
    }

    update(delta) {
        this.mesh.position.x += this.speed * delta;
        
        // Remove if too far
        if (this.mesh.position.x > 50) {
             this.dead = true;
             scene.remove(this.mesh);
             return;
        }

        // Collision Check
        for (const zombie of state.zombies) {
            if (this.mesh.position.distanceTo(zombie.mesh.position) < 2) {
                zombie.takeDamage(this.damage);
                this.dead = true;
                scene.remove(this.mesh);
                break;
            }
        }
    }
}

// --- GAME LOGIC FUNCTIONS ---

function createLawn() {
    const geometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
    geometry.rotateX(-Math.PI / 2);

    for (let x = 0; x < GRID_COLS; x++) {
        for (let z = 0; z < GRID_ROWS; z++) {
            const isDark = (x + z) % 2 === 1;
            const tile = new THREE.Mesh(geometry, isDark ? materials.grassDark : materials.grassLight);
            tile.position.set(
                (x - GRID_COLS / 2 + 0.5) * TILE_SIZE,
                -0.1, // slightly below zero
                (z - GRID_ROWS / 2 + 0.5) * TILE_SIZE
            );
            tile.receiveShadow = true;
            // Store grid data in userdata for raycasting
            tile.userData = { isTile: true, gridX: x, gridZ: z };
            scene.add(tile);
        }
    }
    
    // Add "House" safe zone visualization
    const safeZone = new THREE.Mesh(new THREE.PlaneGeometry(10, TILE_SIZE * GRID_ROWS), new THREE.MeshStandardMaterial({color: 0x5d4037}));
    safeZone.rotateX(-Math.PI/2);
    safeZone.position.set(-(GRID_COLS/2 + 1) * TILE_SIZE, -0.05, 0);
    scene.add(safeZone);
}

function spawnSun(position = null, isNatural = false) {
    if (!position) {
         // Random sky spawn
         position = new THREE.Vector3(
             (Math.random() * GRID_COLS - GRID_COLS / 2) * TILE_SIZE,
             40,
             (Math.random() * GRID_ROWS - GRID_ROWS / 2) * TILE_SIZE
         );
    }

    const sunGeo = new THREE.SphereGeometry(1.5, 8, 8);
    const sun = new THREE.Mesh(sunGeo, materials.sun);
    sun.position.copy(position);
    sun.userData = { isSun: true, destY: 2, spawnTime: Date.now() };
    scene.add(sun);
    state.suns.push(sun);
}

function shoot(position) {
    state.projectiles.push(new Projectile(position));
}

function gameOver() {
    state.isGameOver = true;
    document.getElementById('game-over-screen').classList.remove('hidden');
}

// --- INPUT HANDLING ---

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('click', (event) => {
    if (state.isGameOver) return;
    
    // Ignore clicks on UI
    if (event.target.closest('.plant-card, button')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check click on Suns first
    const sunIntersects = raycaster.intersectObjects(state.suns);
    if (sunIntersects.length > 0) {
        const sunObj = sunIntersects[0].object;
        scene.remove(sunObj);
        state.suns = state.suns.filter(s => s !== sunObj);
        state.sun += 25;
        updateUI();
        return; // Don't place plant if picked sun
    }

    // Check click on Grid
    const intersects = raycaster.intersectObjects(scene.children);
    for (const hit of intersects) {
        if (hit.object.userData.isTile) {
            const { gridX, gridZ } = hit.object.userData;
            tryPlacePlant(gridX, gridZ);
            break;
        }
    }
});

function tryPlacePlant(x, z) {
    const key = `${x},${z}`;
    if (state.grid[key]) return; // Occupied

    const costs = { 'peashooter': 100, 'sunflower': 50, 'wallnut': 50 };
    const cost = costs[state.selectedPlant];

    if (state.sun >= cost) {
        state.sun -= cost;
        const plant = new Plant(state.selectedPlant, x, z);
        state.grid[key] = plant;
        state.plants.push(plant);
        updateUI();
    }
}

// Define selectPlant on window so HTML can see it
window.selectPlant = (type) => {
    state.selectedPlant = type;
    document.querySelectorAll('.plant-card').forEach(el => el.classList.remove('selected'));
    document.querySelector(`.plant-card[data-type="${type}"]`).classList.add('selected');
};

function updateUI() {
    document.getElementById('sun-count').innerText = state.sun;
    document.getElementById('score-count').innerText = state.score;
}

// --- MAIN LOOP ---

let lastSpawnTime = 0;
let lastSunTime = 0;

function animate(time) {
    requestAnimationFrame(animate);

    if (state.isGameOver) return;

    const delta = (time - state.lastTime) / 1000;
    state.lastTime = time;

    // Zombie Spawning
    if (time - lastSpawnTime > ZOMBIE_SPAWN_RATE - Math.min(4000, state.score * 10)) {
        const row = Math.floor(Math.random() * GRID_ROWS);
        state.zombies.push(new Zombie(row));
        lastSpawnTime = time;
    }

    // Sun Spawning (Sky)
    if (time - lastSunTime > SUN_SPAWN_RATE) {
        spawnSun();
        lastSunTime = time;
    }

    // Updates
    state.plants.forEach(p => p.update(time));
    state.zombies.forEach(z => z.update(delta, time));
    
    // Projectiles
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const p = state.projectiles[i];
        p.update(delta);
        if (p.dead) {
            state.projectiles.splice(i, 1);
        }
    }

    // Suns animation
    state.suns.forEach(s => {
        s.rotation.y += delta;
        if (s.userData.spawnTime && s.position.y > s.userData.destY) {
            s.position.y -= delta * 5;
        }
    });

    renderer.render(scene, camera);
}

// Init
createLawn();
updateUI();
animate(0);

// Windows resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
