"""Web service. Logging is set up here, before any submodule runs, so start-up messages (database, restore) reach Render's log."""

import logging
import sys

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
