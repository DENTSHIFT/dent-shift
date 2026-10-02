#!/usr/bin/env python3
"""fields.json から Salesforce メタデータ(ソース形式)と項目一覧ドキュメントを生成する。

    python3 salesforce/tools/generate.py

生成物(手で編集しない):
  salesforce/force-app/main/default/objects/**   項目・カスタムオブジェクト
  salesforce/force-app/main/default/permissionsets/**
  salesforce/manifest/package.xml
  docs/SALESFORCE_CRM_FIELD_SPEC.md
"""
import json
import pathlib
import shutil
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parents[2]
SF = ROOT / "salesforce"
SRC = SF / "force-app" / "main" / "default"
API_VERSION = "60.0"
spec = json.loads((SF / "tools" / "fields.json").read_text())

TYPE_LABELS = {
    "ExternalText": "テキスト(外部ID・一意・大文字小文字区別)",
    "IndexedText": "テキスト(外部ID・重複可、検索用インデックス)",
    "Text": "テキスト",
    "Number": "数値",
    "Checkbox": "チェックボックス",
    "DateTime": "日付/時間",
    "Date": "日付",
    "Url": "URL",
    "LongText": "ロングテキストエリア",
    "Lookup": "参照関係",
    "StaffPicklist": "選択リスト",
    "StaffLongText": "ロングテキストエリア",
    "Existing": "既存項目(変更しない)",
    "ExistingWritable": "既存の標準項目(連携が書き込む)",
    "StaffCheckbox": "チェックボックス(担当者が入力、同期しない)",
}


def expand(fields):
    out = []
    for f in fields:
        if f[0] == "@summary":
            out.extend(spec["summary"])
        else:
            out.append(f)
    return out


def label_of(desc):
    return desc.split("(")[0][:40]


def field_xml(name, ftype, desc, opts):
    lines = [f"    <fullName>{name}</fullName>", f"    <label>{escape(label_of(desc))}</label>",
             f"    <description>{escape(desc)}</description>", f"    <inlineHelpText>{escape(desc)}</inlineHelpText>"]
    if ftype in ("ExternalText", "IndexedText", "Text"):
        lines += ["    <type>Text</type>", f"    <length>{opts['length']}</length>", "    <required>false</required>"]
        if ftype == "ExternalText":
            lines += ["    <externalId>true</externalId>", "    <unique>true</unique>", "    <caseSensitive>true</caseSensitive>"]
        elif ftype == "IndexedText":
            lines += ["    <externalId>true</externalId>", "    <unique>false</unique>"]
        else:
            lines += ["    <externalId>false</externalId>", "    <unique>false</unique>"]
    elif ftype == "Number":
        lines += ["    <type>Number</type>", f"    <precision>{opts['precision']}</precision>",
                  f"    <scale>{opts['scale']}</scale>", "    <required>false</required>", "    <externalId>false</externalId>",
                  "    <unique>false</unique>"]
    elif ftype in ("Checkbox", "StaffCheckbox"):
        lines += ["    <type>Checkbox</type>", f"    <defaultValue>{'true' if opts.get('default') else 'false'}</defaultValue>"]
    elif ftype in ("DateTime", "Date", "Url"):
        lines += [f"    <type>{ftype}</type>", "    <required>false</required>"]
    elif ftype in ("LongText", "StaffLongText"):
        lines += ["    <type>LongTextArea</type>", f"    <length>{opts['length']}</length>", "    <visibleLines>4</visibleLines>"]
    elif ftype == "Lookup":
        lines += ["    <type>Lookup</type>", f"    <referenceTo>{opts['referenceTo']}</referenceTo>",
                  f"    <relationshipName>{opts['relationshipName']}</relationshipName>",
                  f"    <relationshipLabel>{escape(opts['relationshipLabel'])}</relationshipLabel>",
                  "    <deleteConstraint>SetNull</deleteConstraint>", "    <required>false</required>"]
    elif ftype == "StaffPicklist":
        values = "\n".join(
            f"                <value>\n                    <fullName>{escape(v)}</fullName>\n"
            f"                    <default>{'true' if v == opts.get('default') else 'false'}</default>\n"
            f"                    <label>{escape(v)}</label>\n                </value>"
            for v in opts["values"]
        )
        lines += ["    <type>Picklist</type>", "    <required>false</required>",
                  "    <valueSet>\n        <restricted>true</restricted>\n        <valueSetDefinition>\n"
                  "            <sorted>false</sorted>\n" + values + "\n        </valueSetDefinition>\n    </valueSet>"]
    else:
        raise ValueError(ftype)
    if opts.get("trackHistory"):
        lines += ["    <trackHistory>true</trackHistory>"]
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n'
            + "\n".join(lines) + "\n</CustomField>\n")


def object_xml(obj, meta):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>{escape(meta['label'])}</label>
    <pluralLabel>{escape(meta['pluralLabel'])}</pluralLabel>
    <description>DENT SHIFT連携で作成・更新するレコード(外部IDでupsert)。</description>
    <nameField>
        <label>{escape(meta['nameLabel'])}</label>
        <type>Text</type>
    </nameField>
    <deploymentStatus>Deployed</deploymentStatus>
    <sharingModel>ReadWrite</sharingModel>
    <enableActivities>true</enableActivities>
    <enableHistory>true</enableHistory>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <enableFeeds>false</enableFeeds>
    <enableBulkApi>true</enableBulkApi>
    <enableSharing>true</enableSharing>
    <enableStreamingApi>true</enableStreamingApi>
</CustomObject>
"""


def is_sync_written(ftype):
    return ftype not in ("StaffPicklist", "StaffLongText", "StaffCheckbox", "Existing")


def permission_set(name, label, description, objects_perm, field_editable):
    fps, ops = [], []
    for obj, meta in spec["objects"].items():
        for f in expand(meta["fields"]):
            fname, ftype = f[0], f[1]
            if ftype == "ExternalText" and False:
                continue
            editable = field_editable(ftype)
            fps.append(f"""    <fieldPermissions>
        <editable>{'true' if editable else 'false'}</editable>
        <field>{obj}.{fname}</field>
        <readable>true</readable>
    </fieldPermissions>""")
        perm = objects_perm(obj, meta)
        if perm:
            ops.append(f"""    <objectPermissions>
        <allowCreate>{perm['create']}</allowCreate>
        <allowDelete>false</allowDelete>
        <allowEdit>{perm['edit']}</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>false</modifyAllRecords>
        <object>{obj}</object>
        <viewAllRecords>{perm['viewAll']}</viewAllRecords>
    </objectPermissions>""")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>{escape(label)}</label>
    <description>{escape(description)}</description>
    <hasActivationRequired>false</hasActivationRequired>
{chr(10).join(fps)}
{chr(10).join(ops)}
</PermissionSet>
"""


def main():
    objects_dir = SRC / "objects"
    if objects_dir.exists():
        shutil.rmtree(objects_dir)
    perm_dir = SRC / "permissionsets"
    if perm_dir.exists():
        shutil.rmtree(perm_dir)

    members = {"CustomField": [], "CustomObject": [], "PermissionSet": []}
    for obj, meta in spec["objects"].items():
        odir = objects_dir / obj
        (odir / "fields").mkdir(parents=True)
        if meta.get("custom"):
            (odir / f"{obj}.object-meta.xml").write_text(object_xml(obj, meta))
            members["CustomObject"].append(obj)
        for f in expand(meta["fields"]):
            name, ftype, desc, opts = f
            if ftype in ("Existing", "ExistingWritable"):
                continue
            (odir / "fields" / f"{name}.field-meta.xml").write_text(field_xml(name, ftype, desc, opts))
            members["CustomField"].append(f"{obj}.{name}")

    perm_dir.mkdir(parents=True)
    integration = permission_set(
        "DentShift_Integration", "DENT SHIFT 連携ユーザー",
        "DENT SHIFTからの同期専用。連携項目の読み書きと、診断・相談予約の作成/更新のみ(削除なし)。",
        lambda obj, meta: {"create": "true", "edit": "true", "viewAll": "true" if meta.get("custom") else "false"},
        is_sync_written,
    )
    staff = permission_set(
        "DentShift_Sales_Staff", "DENT SHIFT 営業・CS担当",
        "DENT SHIFT連携項目の閲覧と、相談の実施結果・メモの入力。連携項目は読み取り専用。",
        lambda obj, meta: {"create": "false", "edit": "true", "viewAll": "false"} if meta.get("custom") else None,
        lambda ftype: ftype in ("StaffPicklist", "StaffLongText", "StaffCheckbox"),
    )
    (perm_dir / "DentShift_Integration.permissionset-meta.xml").write_text(integration)
    (perm_dir / "DentShift_Sales_Staff.permissionset-meta.xml").write_text(staff)
    members["PermissionSet"] = ["DentShift_Integration", "DentShift_Sales_Staff"]

    manifest = SF / "manifest"
    manifest.mkdir(exist_ok=True)
    types = "\n".join(
        "    <types>\n" + "\n".join(f"        <members>{m}</members>" for m in sorted(ms)) + f"\n        <name>{t}</name>\n    </types>"
        for t, ms in members.items()
    )
    (manifest / "package.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n{types}\n    <version>{API_VERSION}</version>\n</Package>\n'
    )

    # ドキュメント
    rows = []
    for obj, meta in spec["objects"].items():
        for f in expand(meta["fields"]):
            name, ftype, desc, opts = f
            size = opts.get("length") or (f"{opts['precision']},{opts['scale']}" if "precision" in opts else "")
            if ftype == "Lookup":
                size = f"→ {opts['referenceTo']}"
            if ftype == "StaffPicklist":
                size = " / ".join(opts["values"])
            unique = "一意" if ftype == "ExternalText" else ("外部ID(重複可)" if ftype == "IndexedText" else "")
            writer = (
                "担当者が入力(同期しない)" if ftype in ("StaffPicklist", "StaffLongText", "StaffCheckbox")
                else ("既存(読み取りのみ)" if ftype == "Existing" else "連携ユーザー")
            )
            staff_perm = "編集" if ftype in ("StaffPicklist", "StaffLongText", "StaffCheckbox") else "閲覧"
            rows.append(f"| {meta['label']} (`{obj}`) | `{name}` | {TYPE_LABELS[ftype]} {size} | {unique} | {desc} | {writer} | {staff_perm} |")
    doc = ROOT / "docs" / "SALESFORCE_CRM_FIELD_SPEC.md"
    doc.write_text(
        "# Salesforce連携 項目一覧(自動生成)\n\n"
        "このファイルは `salesforce/tools/generate.py` が `salesforce/tools/fields.json` から生成する。手で編集しない。\n"
        "メタデータ本体は `salesforce/force-app/main/default/` 、デプロイ対象一覧は `salesforce/manifest/package.xml`。\n\n"
        f"- 追加する項目: {len(members['CustomField'])}件 / 追加するカスタムオブジェクト: {len(members['CustomObject'])}件 / 権限セット: 2件\n"
        "- 既存項目(`Event_Type__c` / `Registration_Step__c` / `Trial_Ends_At__c`)は変更しない。\n"
        "- 権限: 連携ユーザーには権限セット `DentShift_Integration`(連携項目の編集・削除権限なし)、"
        "営業・CS担当には `DentShift_Sales_Staff`(連携項目は閲覧のみ、相談の実施結果・メモだけ編集)。\n"
        "- 外部ID項目はアプリのID(医院ID・ユーザーID・契約ID・診断ID)とTimeRexの予約IDのみ。メールアドレスは外部IDにしない。\n\n"
        "| オブジェクト | API参照名 | 型・桁 | 一意性 | 用途 | 書き込み | 営業・CS権限 |\n|---|---|---|---|---|---|---|\n"
        + "\n".join(rows) + "\n"
    )
    print(f"fields={len(members['CustomField'])} objects={len(members['CustomObject'])}")


if __name__ == "__main__":
    main()
