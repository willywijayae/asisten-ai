import { useEffect, useMemo, useRef, type ReactElement, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ROSTER, type AgentDef, type AgentId, type OfficeData, type Status } from "./roster";
import { IDLE_SPOTS, locate, route, ROOM, type Place, type Vec2 } from "./world";
import { Cabinets, DeptSign, Desk, MailWall, MarketingBoard, Pantry, Plant, ProfileShelf, Room, ServerRacks, Sofa, TaskBoard, WallClock } from "./props";

// Kantor 3D: tiap agen berjalan ke meja/papan/arsip sesuai aktivitas aslinya di server.

interface Runtime {
  pos: THREE.Vector3;
  facing: number;
  path: Vec2[];
  place: Place;
  pose: "sit" | "stand" | "walk";
  phase: number;
  nextWanderAt: number;
  returnAt: number;
}

export interface SceneProps {
  counts: OfficeData["counts"];
  focus: string[];
  statuses: Record<AgentId, Status>;
  selected: AgentId | null;
  onSelect: (id: AgentId | null) => void;
  night: boolean;
  tzOffsetMin: number;
  /** Agen yang boleh menampilkan gelembung; kosong = semua (layar lebar). */
  bubbles?: AgentId[];
}

export default function OfficeScene({ counts, focus, statuses, selected, onSelect, night, tzOffsetMin, bubbles }: SceneProps) {
  const statusRef = useRef(statuses);
  statusRef.current = statuses;

  const runtimes = useMemo(() => {
    const map = {} as Record<AgentId, Runtime>;
    ROSTER.forEach((a, i) => {
      const loc = locate(`desk:${a.id}`, a.id);
      const [x, z] = loc.access[loc.access.length - 1];
      map[a.id] = {
        pos: new THREE.Vector3(x, 0, z),
        facing: 0,
        path: [],
        place: `desk:${a.id}`,
        pose: "sit",
        phase: 0,
        nextWanderAt: 6 + i * 5 + Math.random() * 20,
        returnAt: 0,
      };
    });
    return map;
  }, []);

  const labels = useRef<Partial<Record<AgentId, HTMLDivElement | null>>>({});

  return (
    <div className="relative h-full w-full">
    <Canvas
      orthographic
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [CENTER[0] + 15, 13, CENTER[2] + 15], zoom: 30, near: 0.1, far: 200 }}
      onPointerMissed={() => onSelect(null)}
      style={{ touchAction: "none" }}
    >
      <color attach="background" args={[night ? "#0f1524" : "#e9eef4"]} />
      <FitZoom />
      <ambientLight intensity={night ? 0.55 : 0.7} />
      <hemisphereLight args={["#fff7ed", "#94a3b8", night ? 0.35 : 0.5]} />
      <directionalLight
        castShadow
        position={[7, 14, 9]}
        intensity={night ? 0.6 : 1.7}
        color={night ? "#c7d2fe" : "#fff8ee"}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0004}
      />
      {night &&
        ROSTER.map((a) => (
          <pointLight key={a.id} position={[a.desk[0], 1.8, a.desk[1]]} intensity={3} distance={4} color="#fcd34d" />
        ))}
      <OrbitControls
        makeDefault
        target={CENTER}
        enableDamping
        dampingFactor={0.08}
        minAzimuthAngle={0.08}
        maxAzimuthAngle={Math.PI / 2 - 0.08}
        minPolarAngle={0.45}
        maxPolarAngle={1.2}
        minZoom={8}
        maxZoom={120}
      />

      <Room night={night} />
      <TaskBoard counts={counts} />
      <MarketingBoard total={counts.marketing} today={counts.marketingToday} focus={focus} />
      <DeptSign x={-2.2} text="Divisi Operasional" color="#0f766e" />
      <DeptSign x={11.3} text="Divisi Marketing" color="#be185d" />
      <Cabinets notes={counts.notes} />
      <MailWall />
      <ProfileShelf />
      <ServerRacks active={statuses.gemma?.mood === "working"} />
      <Pantry />
      <Sofa />
      <WallClock offsetMin={tzOffsetMin} />
      <Plant position={[-7.3, 0, 4.6]} />
      <Plant position={[-8.4, 0, -5.3]} scale={0.9} />
      <Plant position={[8.8, 0, 5.9]} scale={1.1} />
      <Plant position={[2.6, 0, -5.4]} scale={0.8} />
      <Plant position={[10.1, 0, 5.9]} />
      <Plant position={[20, 0, -2.5]} scale={0.8} />
      <Plant position={[17, 0, -5.5]} scale={0.7} />

      {ROSTER.map((a) => (
        <Desk key={a.id} def={a} mood={statuses[a.id]?.mood ?? "idle"} />
      ))}
      {ROSTER.map((a) => (
        <Avatar
          key={a.id}
          def={a}
          rt={runtimes[a.id]}
          status={statuses[a.id]}
          selected={selected === a.id}
          onSelect={onSelect}
        />
      ))}
      <Director runtimes={runtimes} statusRef={statusRef} />
      <LabelTracker runtimes={runtimes} labels={labels} />
    </Canvas>
      {/* Label nama & gelembung: DOM biasa di atas canvas, posisinya diikuti tiap frame. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {ROSTER.map((a) => (
          <div key={a.id} ref={(el) => void (labels.current[a.id] = el)} className="absolute left-0 top-0 opacity-0 will-change-transform">
            <AgentLabel
              def={a}
              status={statuses[a.id]}
              selected={selected === a.id}
              showBubble={!bubbles?.length || bubbles.includes(a.id) || selected === a.id}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Proyeksikan posisi kepala tiap agen ke layar, lalu geser labelnya. */
function LabelTracker({
  runtimes,
  labels,
}: {
  runtimes: Record<AgentId, Runtime>;
  labels: RefObject<Partial<Record<AgentId, HTMLDivElement | null>>>;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const a of ROSTER) {
      const el = labels.current?.[a.id];
      if (!el) continue;
      const r = runtimes[a.id];
      v.set(r.pos.x, 1.7, r.pos.z).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      el.style.zIndex = String(Math.round(1000 - v.z * 500));
      el.style.opacity = "1";
    }
  });
  return null;
}

function AgentLabel({
  def,
  status,
  selected,
  showBubble,
}: {
  def: AgentDef;
  status: Status | undefined;
  selected: boolean;
  showBubble: boolean;
}) {
  const mood = status?.mood ?? "idle";
  const bubble = !showBubble
    ? null
    : mood === "standby"
      ? "💤 siaga"
      : status?.bubble ? (mood === "error" ? "⚠️ " : "") + clipText(status.bubble, selected ? 140 : 60) : null;
  return (
    <div className="flex w-44 flex-col items-center gap-1">
      {bubble && (
        <div
          className={`max-w-full rounded-lg px-2 py-1 text-center text-[10px] leading-snug shadow-md ${
            mood === "error" ? "bg-red-50 text-red-900" : "bg-white text-slate-800"
          }`}
        >
          {bubble}
        </div>
      )}
      <div
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow ${selected ? "ring-2 ring-white" : ""}`}
        style={{ background: def.color }}
      >
        {def.name}
      </div>
    </div>
  );
}

const CENTER: [number, number, number] = [(ROOM.minX + ROOM.maxX) / 2, 0.4, (ROOM.minZ + ROOM.maxZ) / 2];
/** Lebar & tinggi denah saat dilihat dari sudut isometrik (satuan dunia). */
const SPAN_W = (ROOM.maxX - ROOM.minX + ROOM.maxZ - ROOM.minZ) * 0.72;
const SPAN_H = SPAN_W * 0.62;

/** Zoom kamera menyesuaikan layar: seluruh kantor muat di desktop; di HP boleh terpotong (bisa digeser). */
function FitZoom() {
  const { size, camera } = useThree();
  useEffect(() => {
    const fit = Math.min(size.width / SPAN_W, size.height / SPAN_H);
    camera.zoom = THREE.MathUtils.clamp(size.width < 640 ? fit * 1.5 : fit, 10, 80);
    camera.updateProjectionMatrix();
  }, [size.width, size.height, camera]);
  return null;
}

const angleLerp = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** Memutuskan ke mana tiap agen pergi & menggerakkannya di sepanjang rute. */
function Director({
  runtimes,
  statusRef,
}: {
  runtimes: Record<AgentId, Runtime>;
  statusRef: RefObject<Record<AgentId, Status>>;
}) {
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = clock.elapsedTime;
    for (const a of ROSTER) {
      const r = runtimes[a.id];
      const s = statusRef.current?.[a.id];
      const desk: Place = `desk:${a.id}`;

      if (!r.path.length) {
        let goal: Place = desk;
        // Manajer operasional menghampiri anak buah yang sedang ada kendala.
        const troubled =
          a.id === "manajer_ops" && s?.mood === "idle"
            ? ROSTER.find((x) => x.dept === "ops" && x.id !== a.id && statusRef.current?.[x.id]?.mood === "error")
            : undefined;
        if (s?.mood === "visiting" && s.spot) goal = s.spot as Place;
        else if (troubled) goal = `visit:${troubled.id}`;
        else if (s?.mood === "idle") {
          if (r.place === desk) {
            if (t > r.nextWanderAt) {
              goal = IDLE_SPOTS[Math.floor(Math.random() * IDLE_SPOTS.length)];
              r.returnAt = t + 8 + Math.random() * 12;
            }
          } else if ((IDLE_SPOTS as string[]).includes(r.place) && t < r.returnAt) {
            goal = r.place;
          }
          if (goal === desk && r.place !== desk) r.nextWanderAt = t + 25 + Math.random() * 45;
        }
        if (goal !== r.place) {
          r.path = route(r.place, goal, a.id);
          r.place = goal;
        }
      }

      if (r.path.length) {
        const [tx, tz] = r.path[0];
        const dx = tx - r.pos.x;
        const dz = tz - r.pos.z;
        const dist = Math.hypot(dx, dz);
        const busy = s?.mood === "working" || s?.mood === "visiting";
        const step = (busy ? 2.8 : 1.5) * dt;
        if (dist <= step) {
          r.pos.set(tx, 0, tz);
          r.path.shift();
        } else {
          r.pos.x += (dx / dist) * step;
          r.pos.z += (dz / dist) * step;
          r.facing = angleLerp(r.facing, Math.atan2(dx, dz), 0.25);
        }
        r.pose = "walk";
        r.phase += step * 7;
      }
      if (!r.path.length) {
        const loc = locate(r.place, a.id);
        r.pose = loc.pose;
        r.facing = angleLerp(r.facing, loc.facing, 0.12);
      }
    }
  });
  return null;
}

function Part({ size, position, color }: { size: [number, number, number]; position: [number, number, number]; color: string }) {
  return (
    <mesh position={position} castShadow>
      <boxGeometry args={size} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

const RING: Record<string, string> = {
  working: "#22c55e",
  visiting: "#22c55e",
  talking: "#f59e0b",
  error: "#ef4444",
  idle: "#94a3b8",
  standby: "#475569",
};

function Avatar({
  def,
  rt,
  status,
  selected,
  onSelect,
}: {
  def: AgentDef;
  rt: Runtime;
  status: Status | undefined;
  selected: boolean;
  onSelect: (id: AgentId | null) => void;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const mood = status?.mood ?? "idle";
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const seed = useMemo(() => Math.random() * 10, []);
  const { look } = def;

  useFrame(({ clock }) => {
    if (!root.current || !body.current || !head.current) return;
    const t = clock.elapsedTime + seed;
    const m = moodRef.current;
    root.current.position.copy(rt.pos);
    root.current.rotation.y = rt.facing;

    let legs = 0;
    let aL = 0;
    let aR = 0;
    let headX = 0;
    let headY = 0;
    let bob = 0;
    if (rt.pose === "walk") {
      const s = Math.sin(rt.phase);
      legs = s * 0.6;
      aL = -s * 0.5;
      aR = s * 0.5;
      bob = Math.abs(Math.cos(rt.phase)) * 0.04;
    } else if (rt.pose === "sit") {
      if (m === "working") {
        aL = -1.25 + Math.sin(t * 18) * 0.08;
        aR = -1.25 + Math.sin(t * 18 + 1.6) * 0.08;
        headX = 0.12;
      } else if (m === "talking") {
        aR = -1.1 + Math.sin(t * 5) * 0.35;
        aL = -0.5;
        headX = Math.sin(t * 6) * 0.08;
      } else if (m === "standby") {
        aL = aR = -0.5;
        headX = 0.4 + Math.sin(t * 1.2) * 0.04;
      } else if (m === "error") {
        aR = -2.6;
        aL = -0.5;
        headY = Math.sin(t * 9) * 0.25;
      } else {
        aL = aR = -0.55;
        headY = Math.sin(t * 0.4) * 0.35;
      }
    } else {
      // berdiri di tempat tujuan
      if (m === "visiting") {
        aR = -2.3 + Math.sin(t * 7) * 0.2;
        headX = -0.08;
      } else {
        aL = Math.sin(t * 0.8) * 0.05;
        aR = -0.6; // pegang gelas / santai
        headY = Math.sin(t * 0.5) * 0.4;
      }
      bob = Math.sin(t * 1.6) * 0.008;
    }
    const k = 0.25;
    if (legL.current && legR.current) {
      const target = rt.pose === "sit" ? -Math.PI / 2 : legs;
      legL.current.rotation.x = THREE.MathUtils.lerp(legL.current.rotation.x, rt.pose === "sit" ? target : legs, k);
      legR.current.rotation.x = THREE.MathUtils.lerp(legR.current.rotation.x, rt.pose === "sit" ? target : -legs, k);
    }
    if (armL.current) armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, aL, k);
    if (armR.current) armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, aR, k);
    head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, headX, 0.15);
    head.current.rotation.y = THREE.MathUtils.lerp(head.current.rotation.y, headY, 0.15);
    body.current.position.y = bob + (rt.pose === "sit" ? 0.02 : 0);

    if (ring.current && ringMat.current) {
      const busy = m === "working" || m === "visiting";
      const pulse = busy ? 1 + Math.sin(t * 5) * 0.12 : 1;
      ring.current.scale.setScalar((selected ? 1.25 : 1) * pulse);
      ringMat.current.color.set(selected ? "#ffffff" : RING[m]);
      ringMat.current.opacity = busy || selected ? 0.9 : 0.45;
    }
  });

  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(def.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.36, 0.46, 32]} />
        <meshBasicMaterial ref={ringMat} color={RING[mood]} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* area klik yang lebih besar dari badannya */}
      <mesh position={[0, 0.8, 0]} visible={false}>
        <boxGeometry args={[0.7, 1.6, 0.6]} />
      </mesh>
      <group ref={body}>
        {/* kaki (pivot di pinggul) */}
        {[
          [legL, -0.09],
          [legR, 0.09],
        ].map(([ref, x]) => (
          <group key={x as number} ref={ref as RefObject<THREE.Group>} position={[x as number, 0.46, 0]}>
            <Part size={[0.15, 0.44, 0.17]} position={[0, -0.22, 0]} color={look.bottom} />
            <Part size={[0.16, 0.07, 0.24]} position={[0, -0.43, 0.03]} color="#1f2937" />
          </group>
        ))}
        {/* badan */}
        <Part size={[0.44, 0.5, 0.26]} position={[0, 0.72, 0]} color={look.top} />
        {look.extra === "tie" && (
          <>
            <Part size={[0.2, 0.06, 0.02]} position={[0, 0.94, 0.13]} color="#ffffff" />
            <Part size={[0.07, 0.32, 0.02]} position={[0, 0.76, 0.135]} color={look.extraColor ?? "#2563eb"} />
          </>
        )}
        {look.extra === "suit" && (
          <>
            <Part size={[0.14, 0.44, 0.02]} position={[0, 0.74, 0.13]} color="#f8fafc" />
            <Part size={[0.06, 0.34, 0.02]} position={[0, 0.76, 0.14]} color={look.extraColor ?? "#b91c1c"} />
            <Part size={[0.1, 0.46, 0.025]} position={[-0.1, 0.72, 0.135]} color={look.top} />
            <Part size={[0.1, 0.46, 0.025]} position={[0.1, 0.72, 0.135]} color={look.top} />
          </>
        )}
        {look.extra === "scarf" && <Part size={[0.47, 0.09, 0.3]} position={[0, 0.96, 0]} color={look.extraColor ?? "#fde68a"} />}
        {/* lengan (pivot di bahu) */}
        {[
          [armL, -0.29],
          [armR, 0.29],
        ].map(([ref, x]) => (
          <group key={x as number} ref={ref as RefObject<THREE.Group>} position={[x as number, 0.94, 0]}>
            <Part size={[0.13, 0.4, 0.14]} position={[0, -0.18, 0]} color={look.top} />
            <Part size={[0.11, 0.1, 0.11]} position={[0, -0.42, 0]} color={look.skin} />
          </group>
        ))}
        {/* kepala (pivot di leher) */}
        <group ref={head} position={[0, 0.98, 0]}>
          <Part size={[0.36, 0.34, 0.32]} position={[0, 0.21, 0]} color={look.skin} />
          <Part size={[0.05, 0.06, 0.01]} position={[-0.08, 0.23, 0.161]} color="#111827" />
          <Part size={[0.05, 0.06, 0.01]} position={[0.08, 0.23, 0.161]} color="#111827" />
          <Part size={[0.1, 0.02, 0.01]} position={[0, 0.12, 0.161]} color={look.extra === "antenna" ? "#f59e0b" : "#9c4a4a"} />
          <Hair look={look} />
        </group>
      </group>
    </group>
  );
}

function Hair({ look }: { look: AgentDef["look"] }) {
  const c = look.hair;
  const parts: ReactElement[] = [];
  if (look.hairStyle !== "none") {
    parts.push(<Part key="top" size={[0.38, 0.09, 0.34]} position={[0, 0.41, 0]} color={c} />);
    parts.push(<Part key="back" size={[0.38, 0.22, 0.06]} position={[0, 0.3, -0.155]} color={c} />);
  }
  if (look.hairStyle === "spiky")
    [-0.1, 0, 0.1].forEach((x, i) => parts.push(<Part key={`s${i}`} size={[0.08, 0.1, 0.08]} position={[x, 0.49, 0]} color={c} />));
  if (look.hairStyle === "long") {
    parts.push(<Part key="l1" size={[0.4, 0.42, 0.08]} position={[0, 0.2, -0.16]} color={c} />);
    parts.push(<Part key="l2" size={[0.05, 0.3, 0.3]} position={[-0.19, 0.26, -0.01]} color={c} />);
    parts.push(<Part key="l3" size={[0.05, 0.3, 0.3]} position={[0.19, 0.26, -0.01]} color={c} />);
  }
  if (look.hairStyle === "bun")
    parts.push(
      <mesh key="bun" position={[0, 0.5, -0.1]} castShadow>
        <sphereGeometry args={[0.09, 12, 10]} />
        <meshLambertMaterial color={c} />
      </mesh>,
    );
  const x = look.extraColor ?? "#1f2937";
  if (look.extra === "glasses") {
    parts.push(<Part key="g1" size={[0.12, 0.09, 0.02]} position={[-0.08, 0.23, 0.165]} color="#111827" />);
    parts.push(<Part key="g2" size={[0.12, 0.09, 0.02]} position={[0.08, 0.23, 0.165]} color="#111827" />);
    parts.push(<Part key="g3" size={[0.08, 0.06, 0.012]} position={[-0.08, 0.23, 0.172]} color="#c7d2fe" />);
    parts.push(<Part key="g4" size={[0.08, 0.06, 0.012]} position={[0.08, 0.23, 0.172]} color="#c7d2fe" />);
  }
  if (look.extra === "headset") {
    parts.push(<Part key="h1" size={[0.42, 0.04, 0.06]} position={[0, 0.45, 0]} color={x} />);
    parts.push(<Part key="h2" size={[0.06, 0.13, 0.12]} position={[-0.2, 0.22, 0]} color="#0f172a" />);
    parts.push(<Part key="h3" size={[0.06, 0.13, 0.12]} position={[0.2, 0.22, 0]} color="#0f172a" />);
    parts.push(<Part key="h4" size={[0.03, 0.03, 0.14]} position={[0.2, 0.13, 0.1]} color="#0f172a" />);
  }
  if (look.extra === "beret") {
    parts.push(
      <mesh key="b1" position={[0.03, 0.46, 0]} rotation={[0, 0, -0.18]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.06, 16]} />
        <meshLambertMaterial color={x} />
      </mesh>,
    );
  }
  if (look.extra === "cap") {
    parts.push(<Part key="c1" size={[0.4, 0.1, 0.36]} position={[0, 0.44, 0]} color={x} />);
    parts.push(<Part key="c2" size={[0.32, 0.03, 0.16]} position={[0, 0.4, 0.22]} color={x} />);
  }
  if (look.extra === "antenna") {
    parts.push(<Part key="a1" size={[0.03, 0.14, 0.03]} position={[0, 0.45, 0]} color="#94a3b8" />);
    parts.push(
      <mesh key="a2" position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshBasicMaterial color={x} toneMapped={false} />
      </mesh>,
    );
    parts.push(<Part key="a3" size={[0.3, 0.09, 0.01]} position={[0, 0.23, 0.163]} color="#0f172a" />);
    [-0.07, 0.07].forEach((ex, i) =>
      parts.push(
        <mesh key={`e${i}`} position={[ex, 0.23, 0.17]}>
          <planeGeometry args={[0.05, 0.03]} />
          <meshBasicMaterial color={x} toneMapped={false} />
        </mesh>,
      ),
    );
  }
  return <>{parts}</>;
}

function clipText(s: string, n: number) {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}
