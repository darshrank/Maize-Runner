# FieldTwin weather data (NASA POWER)

Every season FieldTwin plays is a real year of weather at a real site.
Tasks are (site, year) pairs: dev = UFGA 1990-2009 (20 seasons), test = UFGA 2010-2024 (15 seasons, held out).

Regenerate everything with `uv run python scripts/fetch_power.py` (raw responses are cached).

## What was fetched

- Source: NASA POWER daily point API, community `AG`, <https://power.larc.nasa.gov/api/temporal/daily/point>
- Site: `UFGA` Gainesville, FL, USA, lat 29.63, lon -82.37 (POWER grid elevation 25 m). Same location as the
  soil and maize experiment (UFGA8201) built into gym-DSSAT. `RALE` (Raleigh, NC) is defined in the script but not fetched.
- Years: 1990-2024, full calendar years. No missing values (-999) in this download; the script would fill
  them by linear interpolation and log the count.

| POWER parameter | our field | unit |
|---|---|---|
| T2M_MAX | `tmax_c` | °C (2 m) |
| T2M_MIN | `tmin_c` | °C (2 m) |
| PRECTOTCORR | `rain_mm` | mm/day (bias-corrected precipitation) |
| ALLSKY_SFC_SW_DWN | `srad_mj_m2` | MJ/m²/day |
| RH2M | `rh_pct` | % (2 m) |
| WS2M | `wind_m_s` | m/s (2 m) |

## Files

- `power/raw/<SITE>_<YEAR>.json`: raw API responses.
- `weather/<SITE>_<YEAR>.json`: list of days `{date, doy, tmax_c, tmin_c, rain_mm, srad_mj_m2, rh_pct, wind_m_s}`.
  Read by the toy simulator and the `get_weather` tool (via `env/weather.py`).
- `dssat_wth/<SITE><YY>01.WTH`: DSSAT weather files, same layout as gym-DSSAT's shipped
  `/opt/dssat_pdi/Weather/UFGA8201.WTH` (header `INSI LAT LONG ELEV TAV AMP REFHT WNDHT`, rows `@DATE SRAD TMAX TMIN RAIN`,
  YYDDD dates). TAV = annual mean temperature; AMP = max minus min of the monthly mean temperatures
  (the shipped 1982 Gainesville file has AMP 13.0; ours range 12.3-19.7, the largest in 2010, the very cold 2009-10 winter).
- All values are rounded to 0.1 so the JSON and the `.WTH` file hold identical numbers.

## How gym-DSSAT picks its weather (investigated in gym-dssat-pdi 0.0.9)

1. Experiment and station: the maize env fills the jinja template `configs/maize/UFGA8201.jinja2` and writes it
   to its run directory as `fileX.MZX`; mode `all` runs treatment 3. The field's weather station is `WSTA = UFGA`.
2. Weather source: `random_weather=True` (the default) sets `WTHER = W` in `*SIMULATION CONTROLS`, i.e. DSSAT's
   stochastic weather generator, seeded from the env seed. `random_weather=False` sets `WTHER = M` (measured
   weather from a `.WTH` file). So the generator can be switched off.
3. Weather files: DSSAT looks in the run directory first, then in `WED` from `DSSATPRO.L48`
   (`/opt/dssat_pdi/Weather`, which ships real UFGA files for some years, e.g. 1982 and 1990).
   gym-DSSAT copies `auxiliary_file_paths` into the run directory, so our file wins.
4. Dates: the X file uses 5-digit `YYDDD` dates: start `SDATE 82030` (Jan 30), initial conditions `ICDAT 82030`,
   planting `PDATE 82057` (Feb 26), automatic-planting window `82050-82064`, harvest window end `HLAST 83057`,
   plus reported irrigation and fertilizer dates. The env state reports `yrdoy` as 7-digit `YYYYDDD`.
   DSSAT reads two-digit years 90-99 as 19xx and 00-24 as 20xx (checked: 1990, 2005 and 2015 simulate the right years).
5. Gotcha: in the state DSSAT sends, `yrdoy` is already the next day; its weather values belong to `yrdoy - 1`.

## How FieldTwin runs a chosen year (`env/dssat_sim.py`)

`reset(site="UFGA", year=Y)` writes a copy of the template with every `82DDD`/`83DDD` date moved to `Y`/`Y+1`
(same day of year) to `.cache/dssat_x/UFGA<Y>.jinja2`, starts gym-DSSAT with `random_weather=False`,
`fileX_template_path=<that copy>` and `auxiliary_file_paths=[data/dssat_wth/UFGA<YY>01.WTH]`.

Validation (`uv run python scripts/validate_dssat_years.py`): the farmer schedule (60/60/40 kg N, 25 mm when dry),
comparing every day DSSAT reported against `weather/UFGA_<year>.json`:

| year | days_checked | weather_mismatches | season_rain_mm | grain_kg_ha | n_leached | irr_mm | maturity_yrdoy |
|---|---|---|---|---|---|---|---|
| 1990 | 152 | 0 | 502 | 7025.3 | 2.35 | 150.0 | 1990181 |
| 2005 | 167 | 0 | 805 | 5169.1 | 65.25 | 50.0 | 2005196 |
| 2015 | 144 | 0 | 422 | 6991.7 | 0.0 | 75.0 | 2015173 |

1990 matching proves DSSAT read our file rather than its own (different) `UFGA9001.WTH`.

## Attribution

These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program.
