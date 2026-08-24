import { useCallback, useEffect, useState } from "react";
import { getMyPrefs, saveMyPrefs } from "@/lib/api";

// Per-license default for the Two-Way Sensitivity nominal-vs-today's framing.
// `defaultToday` is the saved preference (null until loaded / never set);
// `save(bool)` persists it for this license so the surface opens in the
// advisor's preferred framing everywhere.
export function useTwoWayPref() {
  const [defaultToday, setDefaultToday] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyPrefs()
      .then((d) => {
        if (alive && d?.prefs && typeof d.prefs.two_way_today === "boolean") {
          setDefaultToday(d.prefs.two_way_today);
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const save = useCallback((val) => {
    setSaving(true);
    return saveMyPrefs({ two_way_today: !!val })
      .then(() => setDefaultToday(!!val))
      .finally(() => setSaving(false));
  }, []);

  return { defaultToday, loaded, saving, save };
}
