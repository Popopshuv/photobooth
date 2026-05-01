"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Mesh } from "three";

function WireSphere() {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.08;
    ref.current.rotation.x += delta * 0.03;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1.6, 24, 16]} />
      <meshBasicMaterial color="#1a1a1a" wireframe />
    </mesh>
  );
}

export function BackgroundCanvas() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <WireSphere />
      </Canvas>
    </div>
  );
}
