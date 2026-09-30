import { ROSTER, type AgentId, type Spot } from "./roster";

// Denah kantor (satuan dunia ≈ meter). x ke kanan, z ke arah kamera.
// Semua perjalanan lewat lorong tengah (z = 0) lalu masuk lewat titik akses tiap tempat,
// jadi karakter tidak menembus meja tanpa perlu pathfinding.

export type Vec2 = [number, number];
export const ROOM = { minX: -9, maxX: 9.5, minZ: -6, maxZ: 6.5 };
export const AISLE_Z = 0;

export type IdleSpot = "coffee" | "sofa" | "window" | "plant";
export type Place = `desk:${AgentId}` | Spot | IdleSpot;

export interface Location {
  /** Dari lorong (titik pertama, z = 0) sampai tujuan (titik terakhir). */
  access: Vec2[];
  /** Arah hadap saat tiba (radian, 0 = menghadap kamera/+z). */
  facing: number;
  pose: "sit" | "stand";
}

const agentIndex = (id: AgentId) => ROSTER.findIndex((a) => a.id === id);

export function locate(place: Place, who: AgentId): Location {
  const i = agentIndex(who);
  if (place.startsWith("desk:")) {
    const def = ROSTER.find((a) => a.id === place.slice(5))!;
    const [dx, dz] = def.desk;
    const seatZ = dz - 0.75;
    const gapX = dx - 1.75;
    return { access: [[gapX, AISLE_Z], [gapX, seatZ], [dx, seatZ]], facing: 0, pose: "sit" };
  }
  // Tempat bersama: tiap agen punya posisi sendiri supaya tidak bertumpuk.
  const off = (i - 3) * 0.42;
  switch (place as Spot | IdleSpot) {
    case "board":
      return { access: [[1.75, AISLE_Z], [1.75, -4.45], [off, -4.45]], facing: Math.PI, pose: "stand" };
    case "profile":
      return { access: [[-5.25, AISLE_Z], [-5.25, -4.45], [-6.6 + off * 0.35, -4.45]], facing: Math.PI, pose: "stand" };
    case "cabinet":
      return { access: [[-5.25, AISLE_Z], [-7.5, AISLE_Z], [-7.5, -1.6 + off * 0.4]], facing: -Math.PI / 2, pose: "stand" };
    case "mail":
      return { access: [[-5.25, AISLE_Z], [-7.5, AISLE_Z], [-7.5, 2.4 + off * 0.3]], facing: -Math.PI / 2, pose: "stand" };
    case "window":
      return { access: [[5.25, AISLE_Z], [5.25, -4.45], [4.6 + off * 0.3, -4.45]], facing: Math.PI, pose: "stand" };
    case "coffee":
      return { access: [[5.25, AISLE_Z], [7.6, AISLE_Z], [7.6, 2.6 + off * 0.3]], facing: Math.PI / 2, pose: "stand" };
    case "sofa":
      return { access: [[5.25, AISLE_Z], [5.25, 5.7], [6.3 + off * 0.45, 5.7], [6.3 + off * 0.45, 4.95]], facing: 0, pose: "sit" };
    case "plant":
      return { access: [[-5.25, AISLE_Z], [-5.25, 4.6], [-6.4 + off * 0.3, 4.6]], facing: -Math.PI / 2, pose: "stand" };
  }
}

/** Rute dari tempat sekarang ke tempat tujuan: mundur ke lorong, susuri lorong, masuk tujuan. */
export function route(from: Place, to: Place, who: AgentId): Vec2[] {
  if (from === to) return [];
  const a = locate(from, who).access;
  const b = locate(to, who).access;
  return [...a.slice(0, -1).reverse(), ...b];
}

export const IDLE_SPOTS: IdleSpot[] = ["coffee", "sofa", "window", "plant"];
