import QtQuick

// Alarm for the reMarkable (AppLoad frontend). Pick a time of day and set it.
// Times are the tablet's local time (set its time zone, e.g. Europe/London).
// The alarm itself runs in the "openremarkableAlarm" layer that alarm-island.qmd
// adds to the main window, so it still rings after this screen is closed.
// E-paper friendly: black and white only, no animation.
Rectangle {
    id: root
    // AppLoad gives the app the whole screen; the fixed size is for desktop previews
    anchors.fill: parent
    width: 1404
    height: 1872
    color: "white"

    // AppLoad contract: the root declares `close` and `unloading()`.
    signal close
    function unloading() {
        clock.stop();
    }

    // ---- state ---------------------------------------------------------
    readonly property string fontFamily: "reMarkable Sans"
    property int hour: 7
    property int minute: 0
    property double now: Date.now()

    // the alarm layer in the main window (null if the patch isn't installed)
    property var service: null
    readonly property bool armed: !!service && service.alarmAt > 0

    // The layer is a child of MainView, which is one of this app's ancestors
    // (root < BaseView "legacydevice/window/main" < MainView < … < app on 3.25).
    // Walk up the ancestors and check each one's children.
    function findService() {
        if (service) return;
        for (let p = root.parent; p && !service; p = p.parent) {
            const kids = p.children;
            for (let i = 0; i < kids.length; i++) {
                if (kids[i].objectName === "openremarkableAlarm") {
                    service = kids[i];
                    break;
                }
            }
        }
        if (service && service.alarmAt > 0) {
            const d = new Date(service.alarmAt);
            hour = d.getHours();
            minute = d.getMinutes();
        } else if (!picked) {
            // default: 5 minutes from now
            const d = new Date(Date.now() + 5 * 60000);
            hour = d.getHours();
            minute = d.getMinutes();
        }
        picked = true;
    }
    property bool picked: false   // starting time chosen; later retries keep the user's edits
    Component.onCompleted: findService()

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    // next time the clock shows hour:minute (today, or tomorrow if already past)
    function nextAt(h, m) {
        const d = new Date(now);
        d.setHours(h, m, 0, 0);
        if (d.getTime() <= now) d.setDate(d.getDate() + 1);
        return d.getTime();
    }

    function untilText(ms) {
        const mins = Math.max(0, Math.ceil((ms - now) / 60000));
        if (mins < 1) return "in under a minute";
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        if (h === 0) return "in " + m + " min";
        return "in " + h + " h" + (m ? " " + m + " min" : "");
    }

    function stepHour(d) { hour = (hour + d + 24) % 24; }
    function stepMinute(d) { minute = (minute + d + 60) % 60; }
    function fromNow(mins) {
        const d = new Date(Date.now() + mins * 60000);
        hour = d.getHours();
        minute = d.getMinutes();
    }

    function setAlarm() {
        if (!service) return;
        now = Date.now();
        service.setAlarm(nextAt(hour, minute));
    }
    function cancelAlarm() {
        if (service) service.cancelAlarm();
    }

    // refreshes "rings in …"; the text only changes once a minute
    Timer {
        id: clock
        interval: 10000
        repeat: true
        running: true
        onTriggered: root.now = Date.now()
    }

    // ---- small drawn controls -----------------------------------------
    component RoundButton: Rectangle {
        id: btn
        property bool up: true
        signal tapped
        width: 150; height: 150; radius: 75
        border { width: 3; color: "black" }
        // chevron from two bars
        Repeater {
            model: [-1, 1]
            delegate: Rectangle {
                required property int modelData
                width: 46; height: 7; radius: 3
                color: "black"
                x: btn.width / 2 - width / 2 + modelData * 15
                y: btn.height / 2 - height / 2
                rotation: (btn.up ? 1 : -1) * modelData * 40
            }
        }
        MouseArea { anchors.fill: parent; onClicked: btn.tapped() }
    }

    component Pill: Rectangle {
        id: pill
        property string label
        property bool filled: false
        signal tapped
        height: 120; radius: 60
        color: filled ? "black" : "white"
        border { width: 3; color: "black" }
        Text {
            anchors.centerIn: parent
            text: pill.label
            font.family: root.fontFamily; font.pixelSize: 46; font.bold: pill.filled
            color: pill.filled ? "white" : "black"
        }
        MouseArea { anchors.fill: parent; onClicked: pill.tapped() }
    }

    // ---- header --------------------------------------------------------
    Text {
        text: "Alarm"
        font.family: root.fontFamily; font.pixelSize: 56
        font.bold: true
        color: "black"
        anchors { left: parent.left; top: parent.top; leftMargin: 96; topMargin: 80 }
    }

    Text {
        objectName: "nowText"
        text: "Now " + root.pad(new Date(root.now).getHours()) + ":" + root.pad(new Date(root.now).getMinutes())
        font.family: root.fontFamily; font.pixelSize: 40
        color: "black"
        anchors { left: parent.left; top: parent.top; leftMargin: 98; topMargin: 160 }
    }

    Rectangle {
        width: 96; height: 96; radius: 48
        border { width: 3; color: "black" }
        anchors { right: parent.right; top: parent.top; rightMargin: 80; topMargin: 64 }
        Repeater {
            model: [45, -45]
            delegate: Rectangle {
                required property int modelData
                anchors.centerIn: parent
                width: 44; height: 5; radius: 2
                color: "black"
                rotation: modelData
            }
        }
        MouseArea { anchors.fill: parent; onClicked: root.close() }
    }

    // ---- time picker ---------------------------------------------------
    Row {
        id: picker
        anchors { horizontalCenter: parent.horizontalCenter; top: parent.top; topMargin: 380 }
        spacing: 40

        Column {
            spacing: 30
            RoundButton { anchors.horizontalCenter: parent.horizontalCenter; up: true; onTapped: root.stepHour(1) }
            Text {
                objectName: "hourText"
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.pad(root.hour)
                font.family: root.fontFamily; font.pixelSize: 280; font.bold: true
                color: "black"
            }
            RoundButton { anchors.horizontalCenter: parent.horizontalCenter; up: false; onTapped: root.stepHour(-1) }
        }
        Text {
            anchors.verticalCenter: parent.verticalCenter
            text: ":"
            font.family: root.fontFamily; font.pixelSize: 240; font.bold: true
            color: "black"
        }
        Column {
            spacing: 30
            RoundButton { anchors.horizontalCenter: parent.horizontalCenter; up: true; onTapped: root.stepMinute(1) }
            Text {
                objectName: "minuteText"
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.pad(root.minute)
                font.family: root.fontFamily; font.pixelSize: 280; font.bold: true
                color: "black"
            }
            RoundButton { anchors.horizontalCenter: parent.horizontalCenter; up: false; onTapped: root.stepMinute(-1) }
        }
    }

    Text {
        id: status
        objectName: "status"
        anchors { horizontalCenter: parent.horizontalCenter; top: picker.bottom; topMargin: 60 }
        font.family: root.fontFamily; font.pixelSize: 44
        color: "black"
        text: !root.service ? "Alarm service not installed (alarm-island.qmd)"
            : root.armed ? "Set for " + root.pad(new Date(root.service.alarmAt).getHours()) + ":"
                           + root.pad(new Date(root.service.alarmAt).getMinutes()) + ", "
                           + root.untilText(root.service.alarmAt)
            : "Rings " + root.untilText(root.nextAt(root.hour, root.minute))
    }

    // ---- quick picks ---------------------------------------------------
    Row {
        id: quick
        anchors { horizontalCenter: parent.horizontalCenter; top: status.bottom; topMargin: 70 }
        spacing: 24
        Repeater {
            model: [10, 30, 60, 120]
            delegate: Pill {
                required property int modelData
                width: 220; height: 96
                label: modelData < 60 ? "+" + modelData + " min" : "+" + modelData / 60 + " h"
                onTapped: root.fromNow(modelData)
            }
        }
    }

    // ---- actions -------------------------------------------------------
    Row {
        anchors { horizontalCenter: parent.horizontalCenter; top: quick.bottom; topMargin: 70 }
        spacing: 36
        Pill {
            visible: root.armed
            width: 340
            label: "Cancel"
            onTapped: root.cancelAlarm()
        }
        Pill {
            width: 420
            filled: true
            opacity: root.service ? 1 : 0.35
            label: root.armed ? "Update" : "Set alarm"
            onTapped: root.setAlarm()
        }
    }
}
