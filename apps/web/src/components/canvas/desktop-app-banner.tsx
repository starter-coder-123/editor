/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useEditorApi } from "@/context/dapi";
import { createStoredSignal } from "@/lib/store";
import { downloadDesktopApp } from "@/lib/desktop-app";
import { track } from "@/lib/analytics";
import { store } from "@/init";

const BANNER_IMAGE = new URL("@/assets/images/desktop-app-banner.png", import.meta.url).href;

/**
 * Dismissible promo for the desktop app, pinned to the bottom left of the
 * canvas. Hidden in the desktop build, which is the thing being advertised.
 */
export function DesktopAppBanner() {
  return null;
}
