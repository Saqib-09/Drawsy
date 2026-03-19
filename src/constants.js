// ─── Timing ────────────────────────────────────────────────────────────────────
export const TURN_MS       = 70000;   // 70s per drawing turn
export const WORD_PICK_MS  = 12000;   // 12s to pick a word
export const MAX_ROUNDS    = 3;       // full cycles of the draw order
export const MAX_STROKES   = 10;      // points per stroke segment before flush
export const STROKE_FLUSH_MS = 300;   // debounce for batched stroke sync

// ─── Player limits ─────────────────────────────────────────────────────────────
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;         // hard cap (Firestore doc size safety)

// ─── Scoring ───────────────────────────────────────────────────────────────────
// Guesser points — first correct guesser gets full tier, later guessers get 60%
export const SCORING_TIERS = [
  { time: 20000, points: 50 },
  { time: 40000, points: 30 },
  { time: 60000, points: 20 },
  { time: 70000, points: 10 }
];
export const LATE_GUESSER_MULT = 0.6; // subsequent correct guessers get 60%
export const DRAWER_POINTS_MULT = 0.5; // drawer gets 50% of first guesser's points

// ─── Game modes ────────────────────────────────────────────────────────────────
export const MODE_FFA   = "ffa";    // free-for-all: everyone guesses
export const MODE_TEAMS = "teams";  // 2 teams: only teammate guesses

// ─── Team colours ──────────────────────────────────────────────────────────────
export const TEAM_COLORS = [
  { id: "red",  label: "Red Team",  bg: "#fee2e2", border: "#ef4444", text: "#991b1b", badge: "bg-red-100 text-red-800 border-red-300" },
  { id: "blue", label: "Blue Team", bg: "#dbeafe", border: "#3b82f6", text: "#1e40af", badge: "bg-blue-100 text-blue-800 border-blue-300" },
];

// ─── Firebase ─────────────────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBs52rBVHrou5jhH-Nkym7WBFIkrGxrOQk",
  authDomain: "rukh-b2d0d.firebaseapp.com",
  projectId: "rukh-b2d0d",
  storageBucket: "rukh-b2d0d.firebasestorage.app",
  messagingSenderId: "761743033935",
  appId: "1:761743033935:web:a237808ce06d923d504c3a",
  measurementId: "G-GQYXET1B4J"
};

export const APP_ID            = "guess-the-drawing-prod";
export const INITIAL_AUTH_TOKEN = null;

// ─── Words ─────────────────────────────────────────────────────────────────────
export const WORDS = [
  "airplane","alligator","ambulance","angel","ant","apple","arm","axe","backpack","balloon",
  "banana","bandage","barn","baseball","basket","bat","bathtub","beach","bear","bed","bee",
  "beehive","bell","bench","bicycle","bird","book","boot","bottle","bow","bowl","box","bread",
  "bridge","broom","bucket","bus","butterfly","cactus","cake","camera","campfire","candle",
  "candy","cap","car","carrot","castle","cat","cave","chair","cheese","cherry","chicken",
  "chimney","chocolate","cloud","clown","coconut","comb","computer","cookie","cow","crab",
  "crocodile","crown","cup","cupcake","diamond","dinosaur","dog","dolphin","door","dragon",
  "drum","duck","eagle","ear","egg","elephant","engine","envelope","eye","face","farm",
  "feather","fence","fire","fireworks","fish","flag","flashlight","flower","flute","forest",
  "fork","fox","frog","fruit","ghost","giraffe","glasses","glove","goat","grapes","guitar",
  "hammer","hand","hat","helicopter","helmet","honey","horse","hospital","house","igloo",
  "island","jellyfish","jungle","key","kite","ladder","lamp","leaf","lemon","lion","lizard",
  "lock","mango","map","mask","mermaid","milk","mirror","monster","moon","motorcycle",
  "mountain","mushroom","needle","nest","ocean","octopus","onion","owl","paint","palm",
  "panda","pants","paper","peach","pear","pencil","penguin","phone","piano","pig","pineapple",
  "pizza","plane","plant","plate","pumpkin","pyramid","queen","rabbit","rain","rainbow","ring",
  "robot","rocket","rose","rug","sailboat","sand","sandwich","scarf","scissors","shark",
  "sheep","ship","shoe","skateboard","skull","snail","snake","snowman","soap","sock","spider",
  "spoon","sprout","squirrel","star","strawberry","sun","sunglasses","swan","sword","table",
  "tiger","toothbrush","torch","tower","train","tree","truck","turtle","umbrella","unicorn",
  "vase","violin","volcano","waffle","watch","waterfall","whale","wheel","windmill","window",
  "wing","wizard","yarn","zebra","zipper","acorn","apron","ballet","blender","blimp","bouquet",
  "brain","canyon","compass","corn","couch","crane","crystal","cupboard","desk","dragonfly",
  "drone","earring","factory","faucet","flagpole","fountain","garage","garden","globe",
  "goggles","gondola","hairbrush","hammock","harp","highway","hurricane","jigsaw","kayak",
  "lighthouse","mansion","mitten","narwhal","necklace","nutcracker","oatmeal","origami",
  "pancake","parade","parasol","peacock","periscope","phoenix","photograph","pillow","pinwheel",
  "popcorn","popsicle","pottery","puppet","quilt","raccoon","refrigerator","safari","saxophone",
  "scarecrow","scorpion","seahorse","shovel","slipper","sparkler","starfish","stethoscope",
  "submarine","sushi","teacup","telescope","tombstone","tornado","typewriter","wagon","walrus",
  "wheelbarrow","whistle","wreath","yogurt","astronaut","barbecue","binoculars","caterpillar",
  "chameleon","croissant","flamingo","lightbulb","magnet","marshmallow","microscope","moose",
  "muffin","pajamas","pepper","rhino","spacesuit","spaghetti","stapler","sunflower","superhero",
  "tadpole","toaster","treadmill","waterfall","yogurt"
];
