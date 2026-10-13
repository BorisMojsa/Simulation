# Review of the five club conversions

This is a review of the uploaded calibration report, supplemented by the 75 published observation pairs in the previous research pack. It does not independently verify the current fitting code or its parameters.

The reported country-aware model improves aggregate leave-one-club-out mean absolute error from **60.42 to 28.34 Elo**, a **32.08 Elo** improvement. That supports a better scale conversion on this sample. It does not validate simulated match probabilities.

| Country | Paired clubs | Reported MAE (Elo) | Reported RMSE (Elo) | Signed mean error (Elo) |
| --- | ---: | ---: | ---: | ---: |
| Belgium | 15 | 32.25 | 40.66 | +14.33 |
| Colombia | 19 | 16.37 | 20.57 | +12.39 |
| Croatia | 9 | 17.26 | 20.72 | -12.76 |
| Portugal | 17 | 29.46 | 34.54 | +1.93 |
| Serbia | 15 | 44.99 | 61.82 | -32.14 |

The residual sign is not defined in the supplied report, so the direction of systematic bias cannot be inferred here.

Serbia has the largest reported error. Its Zemun and Macva Sabac absolute residuals are 181.40 and 96.39 Elo. These rows must remain visible; investigate identities, edition dates and fitting rather than removing difficult observations.

| Target | Raw FDB | Calibrated ClubElo | Country FDB pair range | Range support |
| --- | ---: | ---: | --- | --- |
| RAAL La Louvière | 1312 | 1432 | 1290-1756 | Within observed range |
| Alianza | 1364 | 1486 | 1297-1630 | Within observed range |
| Varaždin | 1427 | 1485 | 1156-1648 | Within observed range |
| AVS | 1335 | 1423 | 1344-1846 | Extrapolates 9 FDB points below range |
| Vojvodina | 1517 | 1506 | 1171-1705 | Within observed range |

**AVS is mild extrapolation**, nine points below the Portuguese paired minimum. This finding comes from inspecting the published pairs, rather than from the report's broad output acceptance bounds.

The five selected values remain calibrated_from_published_rating. A converted value is an estimate on the ClubElo scale derived from an actual published FootballDatabase observation; it is not a direct ClubElo observation. This differs from assigning a generic league prior.

At the current ClubElo-to-quality slope, Serbia’s 44.99 Elo country MAE corresponds to approximately 2.61 internal quality units before clipping. This describes sample conversion error, not a prediction interval or a known error in Vojvodina’s rating.

The paired editions are four days apart: ClubElo 8 October and FootballDatabase 4 October 2026. A valid audit must retain this limitation.

Required implementation review:

1. Reproduce folds from the actual fitting code. Every fold must refit learned global and country terms without its held-out club.
2. Separate regularization selection from final validation; declare a fixed design choice or use appropriate nested/independent validation when tuning.
3. Define the residual sign and retain every paired residual and outlier.
4. Report country support, input range, extrapolation and parameter versions for each target.
5. Use properly designed sensitivity refits to identify unstable predictions. MAE alone is not a 95% confidence interval.
6. Preserve existing converted baselines if the reported methodology is reproduced and no concrete error is found. Do not manually adjust targets to make a club look stronger.

The reported ClubElo-to-quality anchors are chosen internal game targets, not an empirically fitted outcome model. Keep match-outcome calibration and provider-scale matching as separate claims.
