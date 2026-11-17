# Cache composition canary

This opt-in experiment tests the local action (`uses: ./`), not necessarily the
released `actions/setup-java@v6`. It changes no cache API or default policy.

Run **Validate cache composition** with `workflow_dispatch`. To test a newly
added workflow before it exists on the default branch, push changes to its
workflow, composite action or fixture with `[cache-composition]` in the commit
message. Other pushes do not run the experiment jobs.

Every run/attempt uses isolated keys and fresh Ubuntu jobs. The fixture generates
a POM and in-workspace identity markers, and uses an absolute custom repository
path. It stores only tiny sentinels, not dependencies or credentials.

| Variant | H2 restore | Save owner |
| --- | --- | --- |
| `builtin` | Miss after a POM change | setup-java post action |
| `profile` | Miss; a hashed profile marker also isolates writers | setup-java post action |
| `manual` | H1 through a dedicated same-profile restore prefix | `actions/cache/save` |
| `hybrid` | Built-in miss, then exact restore of an explicitly known H1 key | setup-java post action |

`seed -> seed-consume -> enrich -> consume -> observe` proves that H1 and H2 are
saved, restored exactly, and H2 is not overwritten by an exact-hit consumer's mutations. The hybrid gets its
predecessor key from the seed's artifact; it does not derive a broad prefix from
the built-in key. Manual and hashed-profile variants also test a different
profile's miss using the same paths.

Separate cold-miss producers exercise read-only and writable cases with service
writes enabled. Fresh observers must miss the former and restore the latter.
An exact-hit mutation alone would not prove the read-only gate: immutable
exact-hit caches skip saving regardless of read-only.

The final observers verify persistence after producer post actions. Artifacts
contain assertions and primary identities captured **before** post actions;
their upload or a successful producer job alone does not establish a save.
Use downstream assertions and post-action logs together. The final observers
are read-only even on misses.

The measurement field includes setup and restore, not post-save time. This
sentinel experiment makes no claim about Maven artifact requests, archive size,
storage growth or elimination of transient transfer failures. A controlled Maven
transfer/growth benchmark is required before promoting a new fallback recipe.
For now the guide retains built-in/seed recipes and delegates custom fallback
policy to `actions/cache`; it does not publish an unmeasured fallback recipe.

Keys contain the run ID and attempt for targeted cleanup. Remove only entries
from the specific experiment, if needed, not all repository caches.
