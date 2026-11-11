import { useEffect } from "react";

const finePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

/* Fade/slide elements with .mg-reveal in as they enter the viewport. */
export function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".mg-reveal, .mg-trigger");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* Cursor spotlight: only the [data-spot] element under the pointer is updated (no layout thrash). */
export function useSpotlight(ref) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !finePointer()) return;
    let raf = 0, ev = null;
    const apply = () => {
      raf = 0;
      const el = ev.target.closest?.("[data-spot]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      el.style.setProperty("--my", `${ev.clientY - r.top}px`);
    };
    const onMove = (e) => { ev = e; if (!raf) raf = requestAnimationFrame(apply); };
    root.addEventListener("pointermove", onMove, { passive: true });
    return () => { cancelAnimationFrame(raf); root.removeEventListener("pointermove", onMove); };
  }, [ref]);
}

