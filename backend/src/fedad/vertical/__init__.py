"""Vertical federated learning: two organisations hold different columns about the same people.

Party A (ad platform) holds behaviour features, Party B (advertiser) holds the conversion label. `psi` finds the people both
know without revealing anyone else; `split` trains one model that is cut between them, exchanging only (noised) embeddings
and (noised) gradients. Prototype: the two parties are separate objects with an explicit message boundary, not separate machines.
"""
