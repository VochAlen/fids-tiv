#!/bin/bash
# fix-shadcn-v4.sh
#
# Pokreni OVO u root folderu projekta (/media/podaci1/GitHubNovi/fids-tiv).
#
# Razlika od v3: v3 je provjeravala postojanje SAMO za @/components/ui/*
# uvoze (pretpostavljajući da @/lib/utils i slično UVIJEK postoje). Sad
# kad je lib/utils.ts preimenovan, komponente koje uvoze `cn` odatle
# puca, a v3 ih nije hvatala. v4 provjerava POSTOJANJE fajla na disku za
# BILO KOJI '@/...' uvoz (ne samo iz components/ui/), pored eksternih
# npm paketa — i dalje iterativno, radi kaskadnih zavisnosti bilo koje
# dubine.

ROOT_DIR="$(pwd)"

cd components/ui 2>/dev/null || { echo "Nisi u root folderu projekta (nema components/ui/)"; exit 1; }

# Provjerava da li dati '@/...' uvoz odgovara STVARNOM fajlu na disku
# (bilo koja od uobičajenih ekstenzija). Vraća 0 (postoji) ili 1 (ne postoji).
path_exists() {
  local rel="${1#@/}"  # ukloni '@/' prefiks
  local base="$ROOT_DIR/$rel"
  [ -f "${base}.ts" ] && return 0
  [ -f "${base}.tsx" ] && return 0
  [ -f "${base}/index.ts" ] && return 0
  [ -f "${base}/index.tsx" ] && return 0
  return 1
}

total_renamed=0
pass=1

while true; do
  renamed_this_pass=0

  for f in *.tsx; do
    [ -f "$f" ] || continue

    imports=$(grep -oP "from ['\"]\K[^'\"]+" "$f" 2>/dev/null)
    bad_reason=""

    for imp in $imports; do
      case "$imp" in
        # BILO KOJI '@/...' uvoz (lib/utils, components/ui/X, hooks/...) —
        # provjeri da fajl STVARNO postoji na disku.
        @/*)
          if ! path_exists "$imp"; then
            bad_reason="lokalna zavisnost nedostaje: $imp"
          fi
          ;;
        # Relativni uvozi i react/next — preskoči (rijetko se koriste
        # unutar components/ui/, i teže ih je pouzdano razriješiti bez
        # punog resolvera; dosadašnja iskustva pokazuju da nije bio slučaj).
        ./*|../*|react|react-dom|next|next/*) ;;
        # Pravi npm paket — provjeri node_modules/.
        *)
          if [[ "$imp" == @*/* ]]; then
            pkg=$(echo "$imp" | cut -d'/' -f1-2)
          else
            pkg=$(echo "$imp" | cut -d'/' -f1)
          fi
          if [ ! -d "$ROOT_DIR/node_modules/$pkg" ]; then
            bad_reason="nedostaje paket: $pkg"
          fi
          ;;
      esac
      [ -n "$bad_reason" ] && break
    done

    if [ -n "$bad_reason" ]; then
      echo "[prolaz $pass] PREIMENUJEM: $f  ($bad_reason)"
      mv "$f" "$f.txt"
      renamed_this_pass=1
      total_renamed=$((total_renamed + 1))
    fi
  done

  if [ "$renamed_this_pass" -eq 0 ]; then
    break
  fi
  pass=$((pass + 1))
done

echo ""
if [ "$total_renamed" -eq 0 ]; then
  echo "Nijedan fajl nije preimenovan — components/ui/ je čist."
else
  echo "Ukupno preimenovano: $total_renamed fajl(ova), kroz $pass prolaz(a)."
  echo "Sada probaj 'npm run build' ponovo."
fi