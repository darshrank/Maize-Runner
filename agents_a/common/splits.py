"""Dev is split again so prompt changes can be checked on seasons they were not tuned on.

  tune  = dev 1990-2004 (15 seasons): judge and tune designs here
  check = dev 2005-2009 (5 seasons): confirm a change still helps on unseen seasons before keeping it
  test  = 2010-2024 (15 seasons): sealed; run once at the end (A4)
"""

TUNE_YEARS = range(1990, 2005)
CHECK_YEARS = range(2005, 2010)


def subset_of(task_or_row: dict) -> str:
    """'dev-tune', 'dev-check' or the row's split (test) for one task or eval row."""
    if task_or_row.get("split") != "dev":
        return task_or_row.get("split", "")
    year = int(str(task_or_row["task_id"]).rsplit("-", 1)[1])
    return "dev-tune" if year in TUNE_YEARS else "dev-check"
