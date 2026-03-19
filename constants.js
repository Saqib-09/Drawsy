// Game configuration constants
export const TURN_MS = 70000;      // 70 seconds per turn
export const WORD_PICK_MS = 12000; // 12 seconds to pick a word
export const MAX_ROUNDS = 3;       // Game length in rounds
export const MAX_STROKES = 10;     // Max number of points per stroke segment
export const STROKE_FLUSH_MS = 300; // Debounce delay for batched stroke sync

export const SCORING_TIERS = [
  { time: 20000, points: 50 },
  { time: 40000, points: 30 },
  { time: 60000, points: 20 },
  { time: 70000, points: 10 }
];

// Firebase configuration
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBs52rBVHrou5jhH-Nkym7WBFIkrGxrOQk",
  authDomain: "rukh-b2d0d.firebaseapp.com",
  projectId: "rukh-b2d0d",
  storageBucket: "rukh-b2d0d.firebasestorage.app",
  messagingSenderId: "761743033935",
  appId: "1:761743033935:web:a237808ce06d923d504c3a",
  measurementId: "G-GQYXET1B4J"
};

export const APP_ID = "guess-the-drawing-prod";
export const INITIAL_AUTH_TOKEN = null;

// Words split by difficulty
export const WORDS_BY_DIFFICULTY = {
  easy: [
    "cat", "dog", "sun", "tree", "fish", "bird", "house", "car", "hat", "apple",
    "book", "cup", "eye", "arm", "bee", "egg", "fox", "ant", "pig", "cow",
    "duck", "star", "moon", "cake", "ball", "boat", "door", "hand", "shoe", "rain",
    "fire", "leaf", "ring", "flag", "key", "box", "bed", "fan", "bow", "map",
    "bag", "bat", "bus", "cap", "ear", "fly", "gun", "jar", "leg", "lip",
    "net", "owl", "pen", "pot", "saw", "ski", "top", "web", "zip", "bow",
    "frog", "bear", "lion", "rose", "corn", "bone", "lamp", "ship", "drum", "bell",
    "crab", "swan", "fork", "sock", "coat", "tent", "rock", "wolf", "worm", "seed",
    "cloud", "candy", "chair", "clock", "crown", "dress", "ghost", "grape", "horse", "knife",
    "mouse", "peach", "piano", "plane", "robot", "shark", "shirt", "skate", "sleep", "smile",
    "snake", "spoon", "sword", "tiger", "toast", "train", "truck", "tulip", "whale", "witch"
  ],
  medium: [
    "airplane", "alligator", "ambulance", "backpack", "balloon", "banana", "bandage",
    "baseball", "basket", "bathtub", "beach", "bicycle", "bottle", "bridge", "broom",
    "bucket", "butterfly", "cactus", "camera", "campfire", "candle", "castle",
    "cheese", "cherry", "chicken", "chimney", "chocolate", "clown", "coconut",
    "cookie", "crocodile", "diamond", "dinosaur", "dolphin", "dragon", "eagle",
    "elephant", "envelope", "feather", "fireworks", "flashlight", "flower", "forest",
    "giraffe", "glasses", "glove", "grapes", "guitar", "hammer", "helicopter", "helmet",
    "igloo", "island", "jellyfish", "kite", "ladder", "lemon", "lizard", "mango",
    "mask", "mermaid", "mirror", "monster", "mountain", "mushroom", "octopus",
    "onion", "paint", "panda", "pencil", "penguin", "pineapple", "pizza", "pumpkin",
    "pyramid", "rabbit", "rainbow", "rocket", "sailboat", "sandwich", "scissors",
    "skateboard", "skull", "snail", "snowman", "spider", "squirrel", "strawberry",
    "sunglasses", "table", "toothbrush", "torch", "tower", "turtle", "umbrella",
    "unicorn", "violin", "volcano", "waffle", "waterfall", "windmill", "wizard", "zebra"
  ],
  hard: [
    "acorn", "apron", "asteroid", "astronaut", "barbecue", "binoculars", "blimp",
    "bouquet", "brain", "canyon", "caterpillar", "chameleon", "chihuahua", "compass",
    "crane", "croissant", "crystal", "cupboard", "dragonfly", "drone", "earring",
    "factory", "faucet", "flagpole", "flamingo", "fountain", "freeway", "garage",
    "geyser", "globe", "goggles", "gondola", "hairbrush", "hammock", "harp",
    "headdress", "highway", "hurricane", "jigsaw", "kayak", "ketchup", "laundry",
    "lighthouse", "limousine", "mansion", "microscope", "mitten", "narwhal", "necklace",
    "nightgown", "nutcracker", "oatmeal", "origami", "pacifier", "pancake", "parade",
    "parasol", "peacock", "pendant", "periscope", "phoenix", "photograph", "pier",
    "pinwheel", "poodle", "popcorn", "popsicle", "pottery", "puppet", "quilt",
    "raccoon", "refrigerator", "safari", "saxophone", "scarecrow", "scorpion",
    "seahorse", "sheriff", "shovel", "slipper", "sparkler", "sphinx", "starfish",
    "stethoscope", "submarine", "sushi", "teacup", "telescope", "tombstone",
    "tornado", "typewriter", "wagon", "walrus", "warehouse", "wheelbarrow",
    "whistle", "wreath", "yogurt", "zipper"
  ]
};

// Flat word list (all difficulties combined) — used as fallback
export const WORDS = [
  ...WORDS_BY_DIFFICULTY.easy,
  ...WORDS_BY_DIFFICULTY.medium,
  ...WORDS_BY_DIFFICULTY.hard
];
