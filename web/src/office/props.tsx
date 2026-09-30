import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ROOM } from "./world";
import type { AgentDef, Mood, OfficeData } from "./roster";

// Perabot kantor bergaya low-poly. Teks (papan, label) digambar ke canvas 2D → tekstur,
// jadi tidak perlu memuat font dari luar.

type V3 = [number, number, number];

export function Box({
  size,
  position,
  color,
  rotation,
  emissive,
  shadow = true,
}: {
  size: V3;
  position: V3;
  color: string;
  rotation?: V3;
  emissive?: string;
  shadow?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow={shadow} receiveShadow>
      <boxGeometry args={size} />
      <meshLambertMaterial color={color} emissive={emissive ?? "#000"} />
    </mesh>
  );
}

/** Tekstur dari gambar canvas 2D; digambar ulang saat `key` berubah. */
export function useCanvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, key: string) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [w, h]);
  useEffect(() => {
    const ctx = (texture.image as HTMLCanvasElement).getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
    texture.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture, key]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

const FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** Papan kecil bertulisan (label meja, papan nama dinding). */
export function Sign({
  text,
  sub,
  position,
  rotation,
  width = 1,
  color = "#1f2937",
  fg = "#f8fafc",
}: {
  text: string;
  sub?: string;
  position: V3;
  rotation?: V3;
  width?: number;
  color?: string;
  fg?: string;
}) {
  const ratio = sub ? 3 : 4.5;
  const tex = useCanvasTexture(
    512,
    Math.round(512 / ratio),
    (ctx) => {
      const h = 512 / ratio;
      ctx.fillStyle = color;
      roundRect(ctx, 0, 0, 512, h, 22);
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${sub ? 58 : 64}px ${FONT}`;
      ctx.fillText(text, 256, sub ? h * 0.38 : h / 2, 480);
      if (sub) {
        ctx.globalAlpha = 0.75;
        ctx.font = `500 34px ${FONT}`;
        ctx.fillText(sub, 256, h * 0.74, 480);
      }
    },
    `${text}|${sub}|${color}`,
  );
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, width / ratio]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

function woodTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const tones = ["#c8a27a", "#c09a72", "#cfa982", "#bd956c"];
  for (let row = 0; row < 16; row++) {
    const offset = (row % 2) * 128;
    for (let col = -1; col < 3; col++) {
      ctx.fillStyle = tones[(row * 3 + col + 8) % tones.length];
      ctx.fillRect(col * 256 + offset, row * 32, 256, 32);
      ctx.fillStyle = "rgba(90,60,30,0.25)";
      ctx.fillRect(col * 256 + offset, row * 32, 2, 32);
    }
    ctx.fillStyle = "rgba(90,60,30,0.3)";
    ctx.fillRect(0, row * 32, 512, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 3);
  t.anisotropy = 8;
  return t;
}

export function Room({ night }: { night: boolean }) {
  const floor = useMemo(woodTexture, []);
  const w = ROOM.maxX - ROOM.minX;
  const d = ROOM.maxZ - ROOM.minZ;
  const cx = (ROOM.maxX + ROOM.minX) / 2;
  const cz = (ROOM.maxZ + ROOM.minZ) / 2;
  const wall = "#efe9df";
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshLambertMaterial map={floor} />
      </mesh>
      {/* Tepi lantai supaya terlihat seperti potongan diorama. */}
      <Box size={[w, 0.3, 0.1]} position={[cx, -0.15, ROOM.maxZ + 0.05]} color="#8b6b4a" shadow={false} />
      <Box size={[0.1, 0.3, d]} position={[ROOM.maxX + 0.05, -0.15, cz]} color="#7a5c3e" shadow={false} />

      {/* Dinding belakang & kiri */}
      <Box size={[w + 0.2, 3, 0.2]} position={[cx, 1.5, ROOM.minZ - 0.1]} color={wall} />
      <Box size={[0.2, 3, d]} position={[ROOM.minX - 0.1, 1.5, cz]} color="#e7e0d4" />
      <Box size={[w, 0.14, 0.04]} position={[cx, 0.07, ROOM.minZ + 0.02]} color="#b9a58c" shadow={false} />
      <Box size={[0.04, 0.14, d]} position={[ROOM.minX + 0.02, 0.07, cz]} color="#b9a58c" shadow={false} />

      <Window x={-4.1} width={1.8} night={night} />
      <Window x={4.6} width={2.2} night={night} />

      {/* Karpet area santai */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[6.4, 0.01, 5.2]} receiveShadow>
        <planeGeometry args={[3.2, 2]} />
        <meshLambertMaterial color="#7c9a92" />
      </mesh>
    </group>
  );
}

function Window({ x, width, night }: { x: number; width: number; night: boolean }) {
  const z = ROOM.minZ + 0.02;
  return (
    <group position={[x, 1.75, z]}>
      <Box size={[width + 0.16, 1.36, 0.06]} position={[0, 0, 0]} color="#f8fafc" shadow={false} />
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[width, 1.2]} />
        <meshBasicMaterial color={night ? "#1b2a4e" : "#bfe3ff"} toneMapped={false} />
      </mesh>
      {night &&
        [0.2, -0.3, 0.55, -0.6].map((sx, i) => (
          <mesh key={i} position={[sx * width * 0.5, 0.35 - i * 0.12, 0.04]}>
            <planeGeometry args={[0.03, 0.03]} />
            <meshBasicMaterial color="#fef9c3" />
          </mesh>
        ))}
      <Box size={[0.05, 1.2, 0.06]} position={[0, 0, 0.05]} color="#f8fafc" shadow={false} />
      <Box size={[width, 0.05, 0.06]} position={[0, 0, 0.05]} color="#f8fafc" shadow={false} />
      <Box size={[width + 0.3, 0.06, 0.2]} position={[0, -0.7, 0.08]} color="#e2e8f0" shadow={false} />
    </group>
  );
}

const MOOD_LED: Record<Mood, string> = {
  working: "#22c55e",
  visiting: "#22c55e",
  talking: "#f59e0b",
  error: "#ef4444",
  idle: "#64748b",
  standby: "#334155",
};

/** Meja kerja + kursi + monitor + barang khas tiap agen. */
export function Desk({ def, mood }: { def: AgentDef; mood: Mood }) {
  const [x, z] = def.desk;
  const led = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (!led.current) return;
    const busy = mood === "working" || mood === "visiting";
    led.current.color.set(MOOD_LED[mood]);
    led.current.opacity = busy ? 0.6 + Math.sin(clock.elapsedTime * 8) * 0.4 : 1;
  });
  const top = "#e9dcc8";
  return (
    <group position={[x, 0, z]}>
      {/* meja */}
      <Box size={[1.6, 0.06, 0.8]} position={[0, 0.72, 0]} color={top} />
      {[-0.74, 0.74].map((lx) => (
        <Box key={lx} size={[0.06, 0.7, 0.72]} position={[lx, 0.35, 0]} color="#9ca3af" />
      ))}
      <Box size={[1.4, 0.4, 0.03]} position={[0, 0.45, 0.36]} color="#d6c7ae" />
      {/* monitor (layar menghadap agen) + lampu status di punggung monitor */}
      <Box size={[0.08, 0.2, 0.08]} position={[0, 0.85, 0.2]} color="#374151" />
      <Box size={[0.78, 0.46, 0.05]} position={[0, 1.13, 0.2]} color="#1f2937" />
      <mesh position={[0, 1.13, 0.172]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.7, 0.38]} />
        <meshBasicMaterial color={mood === "working" || mood === "visiting" ? "#a5f3fc" : "#334155"} toneMapped={false} />
      </mesh>
      <mesh position={[0.3, 0.95, 0.227]}>
        <circleGeometry args={[0.035, 12]} />
        <meshBasicMaterial ref={led} color={MOOD_LED[mood]} transparent toneMapped={false} />
      </mesh>
      <mesh position={[-0.12, 1.13, 0.228]}>
        <circleGeometry args={[0.06, 16]} />
        <meshBasicMaterial color={def.color} toneMapped={false} />
      </mesh>
      <Box size={[0.5, 0.025, 0.16]} position={[0, 0.76, -0.12]} color="#374151" />
      <DeskProp def={def} />
      <Sign text={def.name} sub={def.role} position={[0, 0.48, 0.42]} width={0.95} color={def.color} />
      {/* kursi */}
      <group position={[0, 0, -0.75]}>
        <Box size={[0.52, 0.08, 0.5]} position={[0, 0.43, 0]} color="#334155" />
        <Box size={[0.52, 0.55, 0.07]} position={[0, 0.72, -0.25]} color="#334155" />
        <Box size={[0.06, 0.4, 0.06]} position={[0, 0.2, 0]} color="#475569" />
        <Box size={[0.46, 0.04, 0.46]} position={[0, 0.02, 0]} color="#1f2937" />
      </group>
    </group>
  );
}

function DeskProp({ def }: { def: AgentDef }) {
  switch (def.id) {
    case "haiku": // tumpukan kertas catatan + mug
      return (
        <group>
          {[0, 1, 2].map((i) => (
            <Box key={i} size={[0.26, 0.02, 0.2]} position={[-0.55, 0.76 + i * 0.022, 0.05]} rotation={[0, i * 0.2, 0]} color={["#fde68a", "#bbf7d0", "#fbcfe8"][i]} />
          ))}
          <Mug x={0.58} color="#22c55e" />
        </group>
      );
    case "opus": // buku tebal + lampu meja
      return (
        <group>
          <Box size={[0.3, 0.08, 0.22]} position={[-0.55, 0.79, 0.05]} color="#7c3aed" />
          <Box size={[0.28, 0.06, 0.2]} position={[-0.55, 0.86, 0.05]} color="#1e293b" />
          <Box size={[0.04, 0.35, 0.04]} position={[0.62, 0.92, 0.2]} color="#374151" />
          <Box size={[0.18, 0.08, 0.14]} position={[0.55, 1.1, 0.16]} color="#fbbf24" emissive="#7c5a00" />
        </group>
      );
    case "whisper": // mikrofon + gelombang suara
      return (
        <group>
          <Box size={[0.12, 0.02, 0.12]} position={[-0.55, 0.76, 0.05]} color="#1f2937" />
          <Box size={[0.03, 0.2, 0.03]} position={[-0.55, 0.86, 0.05]} color="#6b7280" />
          <mesh position={[-0.55, 1.0, 0.05]} castShadow>
            <capsuleGeometry args={[0.045, 0.08, 4, 10]} />
            <meshLambertMaterial color="#94a3b8" />
          </mesh>
          <Mug x={0.58} color="#06b6d4" />
        </group>
      );
    case "gemma": // chip / papan sirkuit
      return (
        <group>
          <Box size={[0.3, 0.03, 0.24]} position={[-0.55, 0.765, 0.05]} color="#166534" />
          <Box size={[0.1, 0.03, 0.1]} position={[-0.55, 0.79, 0.05]} color="#111827" />
          <Mug x={0.58} color="#f59e0b" />
        </group>
      );
    case "pengingat": // jam meja
      return (
        <group>
          <mesh position={[-0.55, 0.88, 0.05]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.13, 0.13, 0.06, 20]} />
            <meshLambertMaterial color="#dc2626" />
          </mesh>
          <mesh position={[-0.55, 0.88, 0.085]}>
            <circleGeometry args={[0.1, 20]} />
            <meshBasicMaterial color="#fff7ed" />
          </mesh>
          <Mug x={0.58} color="#ef4444" />
        </group>
      );
    case "briefing": // map laporan
      return (
        <group>
          <Box size={[0.32, 0.03, 0.24]} position={[-0.55, 0.765, 0.05]} color="#2563eb" />
          <Box size={[0.3, 0.012, 0.22]} position={[-0.55, 0.785, 0.05]} color="#f8fafc" />
          <Mug x={0.58} color="#3b82f6" />
        </group>
      );
    case "claude": // laptop tamu
      return (
        <group position={[-0.5, 0, 0.02]}>
          <Box size={[0.36, 0.02, 0.24]} position={[0, 0.76, 0]} color="#d4d4d8" />
          <Box size={[0.36, 0.24, 0.015]} position={[0, 0.88, 0.12]} rotation={[-0.25, 0, 0]} color="#d4d4d8" />
          <mesh position={[0, 0.88, 0.128]} rotation={[-0.25, 0, 0]}>
            <planeGeometry args={[0.1, 0.1]} />
            <meshBasicMaterial color="#d97757" />
          </mesh>
        </group>
      );
  }
}

function Mug({ x, color }: { x: number; color: string }) {
  return (
    <mesh position={[x, 0.81, -0.1]} castShadow>
      <cylinderGeometry args={[0.05, 0.045, 0.12, 12]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

/** Papan tugas di dinding belakang, isinya angka asli dari database. */
export function TaskBoard({ counts }: { counts: OfficeData["counts"] }) {
  const key = JSON.stringify(counts);
  const tex = useCanvasTexture(
    1024,
    460,
    (ctx) => {
      ctx.fillStyle = "#fbfaf7";
      ctx.fillRect(0, 0, 1024, 460);
      ctx.fillStyle = "#1f2937";
      ctx.font = `800 44px ${FONT}`;
      ctx.textBaseline = "top";
      ctx.fillText("PAPAN TUGAS", 36, 26);
      ctx.fillStyle = "#6b7280";
      ctx.font = `500 26px ${FONT}`;
      ctx.fillText(`${counts.notes} catatan di Second Brain`, 36, 80);
      const cols: [string, number, string][] = [
        ["Aktif", counts.open, "#fde68a"],
        ["Menunggu", counts.pending, "#bfdbfe"],
        ["Terlewat", counts.overdue, "#fecaca"],
        ["Selesai hari ini", counts.doneToday, "#bbf7d0"],
      ];
      cols.forEach(([label, n, color], i) => {
        const x = 36 + i * 244;
        ctx.fillStyle = "#e5e7eb";
        ctx.fillRect(x, 130, 228, 3);
        ctx.fillStyle = "#374151";
        ctx.font = `700 26px ${FONT}`;
        ctx.fillText(label, x, 146, 228);
        ctx.font = `800 72px ${FONT}`;
        ctx.fillStyle = "#111827";
        ctx.fillText(String(n), x, 184);
        // tempelan kertas kecil, maksimal 6 per kolom
        for (let k = 0; k < Math.min(n, 6); k++) {
          ctx.fillStyle = color;
          const sx = x + (k % 3) * 74;
          const sy = 280 + Math.floor(k / 3) * 78;
          ctx.save();
          ctx.translate(sx + 32, sy + 32);
          ctx.rotate(((k * 37) % 11) / 100 - 0.05);
          ctx.fillRect(-32, -32, 64, 64);
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.fillRect(-22, -14, 44, 4);
          ctx.fillRect(-22, -2, 30, 4);
          ctx.restore();
        }
      });
    },
    key,
  );
  return (
    <group position={[0, 1.65, ROOM.minZ + 0.05]}>
      <Box size={[4.9, 2.3, 0.08]} position={[0, 0, 0]} color="#78716c" shadow={false} />
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[4.7, 2.1]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <Box size={[4.4, 0.06, 0.14]} position={[0, -1.2, 0.08]} color="#a8a29e" shadow={false} />
    </group>
  );
}

export function Cabinets({ notes }: { notes: number }) {
  const x = ROOM.minX + 0.35;
  return (
    <group>
      {[-2.3, -1.6, -0.9].map((z, i) => (
        <group key={z} position={[x, 0, z]}>
          <Box size={[0.6, 1.3, 0.62]} position={[0, 0.65, 0]} color={["#94a3b8", "#a1a1aa", "#94a3b8"][i]} />
          {[0.3, 0.65, 1.0].map((y) => (
            <group key={y}>
              <Box size={[0.02, 0.3, 0.56]} position={[0.31, y, 0]} color="#cbd5e1" shadow={false} />
              <Box size={[0.03, 0.03, 0.16]} position={[0.33, y + 0.08, 0]} color="#475569" shadow={false} />
            </group>
          ))}
        </group>
      ))}
      <Sign text="Arsip Catatan" sub={`${notes} catatan`} position={[ROOM.minX + 0.02, 2.0, -1.6]} rotation={[0, Math.PI / 2, 0]} width={1.5} color="#334155" />
    </group>
  );
}

export function MailWall() {
  const x = ROOM.minX + 0.2;
  return (
    <group>
      <Box size={[0.4, 1.0, 1.4]} position={[x, 1.25, 2.4]} color="#b45309" />
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => (
          <Box key={`${row}${col}`} size={[0.03, 0.22, 0.36]} position={[x + 0.21, 0.95 + row * 0.3, 2.0 + col * 0.42]} color="#78350f" shadow={false} />
        )),
      )}
      {[
        [1.25, 2.0],
        [0.95, 2.84],
        [1.55, 2.42],
      ].map(([y, z], i) => (
        <Box key={i} size={[0.04, 0.12, 0.24]} position={[x + 0.24, y, z]} color="#f8fafc" shadow={false} />
      ))}
      <Sign text="Gmail & Drive" position={[ROOM.minX + 0.02, 2.1, 2.4]} rotation={[0, Math.PI / 2, 0]} width={1.4} color="#b45309" />
    </group>
  );
}

export function ProfileShelf() {
  const z = ROOM.minZ + 0.25;
  const books = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6"];
  return (
    <group position={[-6.6, 0, z]}>
      <Box size={[1.7, 2.0, 0.4]} position={[0, 1.0, 0]} color="#92400e" />
      {[0.45, 1.05, 1.65].map((y, r) => (
        <group key={y}>
          <Box size={[1.6, 0.04, 0.36]} position={[0, y - 0.22, 0.03]} color="#78350f" shadow={false} />
          {books.map((c, i) => (
            <Box
              key={i}
              size={[0.14, 0.34 - ((i + r) % 3) * 0.04, 0.26]}
              position={[-0.62 + i * 0.19, y - 0.03 - ((i + r) % 3) * 0.02, 0.06]}
              color={books[(i + r * 2) % books.length]}
              shadow={false}
            />
          ))}
        </group>
      ))}
      <Sign text="Profil & Memori" sub="siapa pemiliknya" position={[0, 2.35, 0.22]} width={1.5} color="#92400e" />
    </group>
  );
}

export function ServerRacks({ active }: { active: boolean }) {
  const leds = useRef<THREE.MeshBasicMaterial[]>([]);
  useFrame(({ clock }) => {
    leds.current.forEach((m, i) => {
      if (!m) return;
      const on = Math.sin(clock.elapsedTime * (active ? 9 : 2) + i * 1.7) > 0;
      m.color.set(on ? (i % 3 === 0 ? "#f59e0b" : "#22c55e") : "#14532d");
    });
  });
  return (
    <group>
      {[7.4, 8.4].map((x, r) => (
        <group key={x} position={[x, 0, ROOM.minZ + 0.45]}>
          <Box size={[0.85, 2.2, 0.7]} position={[0, 1.1, 0]} color="#1f2937" />
          {Array.from({ length: 7 }, (_, i) => (
            <group key={i}>
              <Box size={[0.75, 0.2, 0.02]} position={[0, 0.35 + i * 0.26, 0.36]} color="#374151" shadow={false} />
              <mesh position={[0.28, 0.35 + i * 0.26, 0.375]}>
                <planeGeometry args={[0.05, 0.05]} />
                <meshBasicMaterial ref={(m) => void (m && (leds.current[r * 7 + i] = m))} color="#22c55e" toneMapped={false} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

export function Pantry() {
  const x = ROOM.maxX - 0.8;
  return (
    <group>
      <Box size={[0.7, 0.92, 2.0]} position={[x, 0.46, 2.7]} color="#e7e5e4" />
      <Box size={[0.76, 0.05, 2.06]} position={[x, 0.94, 2.7]} color="#57534e" />
      {/* mesin kopi */}
      <Box size={[0.4, 0.5, 0.36]} position={[x, 1.22, 2.2]} color="#292524" />
      <Box size={[0.12, 0.06, 0.12]} position={[x - 0.16, 1.05, 2.2]} color="#f8fafc" />
      {/* dispenser air */}
      <mesh position={[x, 1.25, 3.3]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.5, 16]} />
        <meshLambertMaterial color="#7dd3fc" transparent opacity={0.8} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[x - 0.05, 1.0, 2.7 + i * 0.13]} castShadow>
          <cylinderGeometry args={[0.04, 0.035, 0.1, 10]} />
          <meshLambertMaterial color={["#f97316", "#10b981", "#6366f1"][i]} />
        </mesh>
      ))}
      <Sign text="Pantry" position={[x - 0.36, 1.75, 2.7]} rotation={[0, -Math.PI / 2, 0]} width={0.9} color="#57534e" />
    </group>
  );
}

export function Sofa() {
  return (
    <group position={[6.3, 0, 4.7]}>
      <Box size={[2.4, 0.42, 0.8]} position={[0, 0.21, 0.2]} color="#4f46e5" />
      <Box size={[2.4, 0.6, 0.22]} position={[0, 0.6, -0.2]} color="#4338ca" />
      <Box size={[0.22, 0.6, 0.8]} position={[-1.2, 0.35, 0.2]} color="#4338ca" />
      <Box size={[0.22, 0.6, 0.8]} position={[1.2, 0.35, 0.2]} color="#4338ca" />
      <Box size={[0.4, 0.3, 0.12]} position={[-0.7, 0.55, -0.02]} rotation={[0.2, 0.2, 0]} color="#fbbf24" />
    </group>
  );
}

export function Plant({ position, scale = 1 }: { position: V3; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.5, 12]} />
        <meshLambertMaterial color="#c2410c" />
      </mesh>
      {[
        [0, 0.8, 0, 0.36],
        [0.16, 1.05, 0.05, 0.26],
        [-0.14, 1.1, -0.06, 0.24],
        [0.02, 1.3, 0.02, 0.2],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshLambertMaterial color={i % 2 ? "#15803d" : "#16a34a"} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Jam dinding (WIB) di dinding kiri. */
export function WallClock({ offsetMin }: { offsetMin: number }) {
  const hour = useRef<THREE.Group>(null);
  const minute = useRef<THREE.Group>(null);
  useFrame(() => {
    const d = new Date(Date.now() + offsetMin * 60_000);
    const m = d.getUTCMinutes() + d.getUTCSeconds() / 60;
    const h = (d.getUTCHours() % 12) + m / 60;
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(h / 12) * Math.PI * 2;
  });
  return (
    <group position={[ROOM.minX + 0.03, 2.25, 0.6]} rotation={[0, Math.PI / 2, 0]}>
      <mesh>
        <circleGeometry args={[0.42, 32]} />
        <meshBasicMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0, 0, 0.005]}>
        <circleGeometry args={[0.37, 32]} />
        <meshBasicMaterial color="#fffbeb" />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[Math.sin((i / 12) * Math.PI * 2) * 0.31, Math.cos((i / 12) * Math.PI * 2) * 0.31, 0.01]}>
          <circleGeometry args={[i % 3 === 0 ? 0.025 : 0.014, 8]} />
          <meshBasicMaterial color="#1f2937" />
        </mesh>
      ))}
      <group ref={hour} position={[0, 0, 0.015]}>
        <mesh position={[0, 0.09, 0]}>
          <planeGeometry args={[0.035, 0.18]} />
          <meshBasicMaterial color="#111827" />
        </mesh>
      </group>
      <group ref={minute} position={[0, 0, 0.02]}>
        <mesh position={[0, 0.13, 0]}>
          <planeGeometry args={[0.022, 0.26]} />
          <meshBasicMaterial color="#dc2626" />
        </mesh>
      </group>
    </group>
  );
}
