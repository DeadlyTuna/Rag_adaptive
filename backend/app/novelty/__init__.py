"""Research extensions to the adaptive-RAG pipeline (switched with NOVELTIES, see config).

    1  context.py, facts in schemas.World   scope- and time-aware (bitemporal) facts
    2  intent_weights.py                    ranking weights per question type, with shrinkage
    3  verify.py                            poisoning defence: verify corrections, learn user trust
    4  counterfactual.py                    "what would plain RAG have said?" for any answer
    5  decay.py                             forgetting rates fitted from reuse (survival analysis)
    6  answerability.py                     answer confidence; clarify or abstain
    7  consolidate.py                       merge near-duplicate memories, archive faded ones
    8  crowd.py                             private memories per student, crowd-verified shared facts
    9  propagation.py                       reliability changes spread to similar passages
    10 staleness.py                         how stale every passage and memory is (the terrain mode)
    11 reminders.py                         reminders scheduled from temporary memories
    12 ../../bench/                         the benchmark that measures all of it, with ablations

Each module is small and pure: functions over the World. The engine decides when to
call them; with the novelties off none of them run and the pipeline is unchanged
(tests/test_parity.py still matches the TypeScript reference engine).
"""
