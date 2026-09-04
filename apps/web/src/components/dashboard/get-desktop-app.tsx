/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { downloadDesktopApp } from "@/lib/desktop-app";
import { createStoredSignal } from "@/lib/store";
import { track } from "@/lib/analytics";
import { store } from "@/init";

/**
 * Promo bar pinned below the dashboard content. Like the canvas banner, it is
 * hidden in the desktop build, which is the thing it advertises.
 *
 * The design has no dismiss affordance, so hiding it lives in a right-click
 * context menu on the bar itself.
 */
export function DashboardGetDesktopApp() {
  return null;
}
