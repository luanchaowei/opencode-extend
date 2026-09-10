#!/usr/bin/env bash
# skill-manager.sh — 安装/卸载/列出本项目 .opencode/skills 下的所有 skill，并合并 AGENTS.md
#
# 用法:
#   ./skill-manager.sh install [--path <目标skills目录>]   安装所有 skill 并合并 AGENTS.md
#   ./skill-manager.sh uninstall [--path <目标skills目录>] 卸载已安装的 skill 并移除 AGENTS.md 中本项目引入的规则
#   ./skill-manager.sh list [--path <目标skills目录>]      列出可安装/已安装状态
#   ./skill-manager.sh --help | -h                          查看帮助
#
# 目录约定（默认全局，任何会话生效）:
#   skills 目录: ~/.config/opencode/skills
#   AGENTS.md : ~/.config/opencode/AGENTS.md
#
# AGENTS.md 处理规则:
#   install   - 目标不存在：直接复制；已存在：按 "## 规则名" 分节合并——
#               同名规则用本项目版本覆盖，目标独有规则保留，新增规则追加
#   uninstall - 按本项目 AGENTS.md 的规则名，从目标中移除对应节（目标独有规则保留）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="${SCRIPT_DIR}/.opencode/skills"
AGENTS_SRC="${SCRIPT_DIR}/AGENTS.md"

DEFAULT_TARGET="${HOME}/.config/opencode/skills"

usage() {
  cat <<EOF
用法: $0 <命令> [--path <目标skills目录>]

命令（支持带或不带 -- 前缀，二者等价）:
  install | --install              安装所有 skill 并合并 AGENTS.md
  uninstall | --uninstall          卸载已安装的 skill，并从 AGENTS.md 移除本项目引入的规则
  list | --list                    列出源 skill 及安装状态
  --help | -h | help               查看本帮助
                                   （不带任何参数时同样显示本帮助）

选项:
  --path <目录> 或 --path=<目录>    目标 skills 目录，必须与 install/uninstall/list 命令一起使用
                                   未指定时默认 ~/.config/opencode/skills（当前用户家目录下）
                                   AGENTS.md 位于该目录上一级
                                   （兼容位置参数用法: $0 install <目录>）

示例:
  $0 --install                                # 安装到全局目录
  $0 --install --path /path/to/skills         # 安装到指定目录
  $0 install --path=/path/to/skills           # 同上
  $0 --uninstall --path /path/to/skills       # 从指定目录卸载
  $0 --list --path /path/to/skills            # 查看指定目录安装状态
EOF
}

resolve_target() {
  TARGET_DIR="${1:-${DEFAULT_TARGET}}"
  AGENTS_TGT="$(dirname "${TARGET_DIR}")/AGENTS.md"
}

# ---- skills 操作 ----
install_skills() {
  if [ ! -d "${SKILLS_SRC}" ]; then
    echo "错误: 未找到 skill 源目录 ${SKILLS_SRC}" >&2
    exit 1
  fi
  if [ ! -d "${TARGET_DIR}" ] && ! mkdir -p "${TARGET_DIR}"; then
    echo "错误: 无法创建目标目录 ${TARGET_DIR}" >&2
    exit 1
  fi
  local found=0 skill_path skill_name
  for skill_path in "${SKILLS_SRC}"/*/; do
    skill_name="$(basename "${skill_path}")"
    if [ ! -f "${skill_path}SKILL.md" ]; then
      echo "跳过（缺少 SKILL.md）: ${skill_name}" >&2
      continue
    fi
    found=1
    if [ -d "${TARGET_DIR}/${skill_name}" ]; then
      echo "已存在同名 skill，将被覆盖: ${TARGET_DIR}/${skill_name}"
      rm -rf "${TARGET_DIR}/${skill_name}"
    fi
    cp -r "${skill_path}" "${TARGET_DIR}/${skill_name}"
    echo "安装成功: ${skill_path} -> ${TARGET_DIR}/${skill_name}"
  done
  if [ "${found}" -eq 0 ]; then
    echo "错误: ${SKILLS_SRC} 下没有找到任何有效的 skill（需含 SKILL.md）" >&2
    exit 1
  fi
}

uninstall_skills() {
  if [ ! -d "${SKILLS_SRC}" ]; then
    echo "错误: 未找到 skill 源目录 ${SKILLS_SRC}" >&2
    exit 1
  fi
  local removed=0 skill_path skill_name
  for skill_path in "${SKILLS_SRC}"/*/; do
    skill_name="$(basename "${skill_path}")"
    if [ -d "${TARGET_DIR}/${skill_name}" ]; then
      rm -rf "${TARGET_DIR}/${skill_name}"
      echo "卸载成功: ${TARGET_DIR}/${skill_name}"
      removed=1
    else
      echo "未安装（跳过）: ${skill_name}"
    fi
  done
  if [ "${removed}" -eq 0 ]; then
    echo "目标目录下没有已安装的本项目 skill: ${TARGET_DIR}"
  fi
}

list_skills() {
  if [ ! -d "${SKILLS_SRC}" ]; then
    echo "错误: 未找到 skill 源目录 ${SKILLS_SRC}" >&2
    exit 1
  fi
  echo "源目录: ${SKILLS_SRC}"
  echo "目标目录: ${TARGET_DIR}"
  echo "--------------------------------------------"
  printf "%-40s %-12s %s\n" "SKILL" "状态" "位置"
  echo "--------------------------------------------"
  local skill_path skill_name status
  for skill_path in "${SKILLS_SRC}"/*/; do
    skill_name="$(basename "${skill_path}")"
    if [ ! -f "${skill_path}SKILL.md" ]; then
      printf "%-40s %-12s\n" "${skill_name}" "无效(缺SKILL.md)"
      continue
    fi
    if [ -f "${TARGET_DIR}/${skill_name}/SKILL.md" ]; then
      if diff -rq "${skill_path}" "${TARGET_DIR}/${skill_name}" >/dev/null 2>&1; then
        status="已安装(一致)"
      else
        status="已安装(有更新)"
      fi
    else
      status="未安装"
    fi
    printf "%-40s %-12s %s\n" "${skill_name}" "${status}" "${TARGET_DIR}/${skill_name}"
  done
  if [ -f "${AGENTS_TGT}" ]; then
    echo "--------------------------------------------"
    echo "AGENTS.md: ${AGENTS_TGT}（存在）"
  else
    echo "--------------------------------------------"
    echo "AGENTS.md: ${AGENTS_TGT}（不存在）"
  fi
}

# ---- AGENTS.md 操作 ----
merge_agents() {
  if [ ! -f "${AGENTS_SRC}" ]; then
    echo "未找到 ${AGENTS_SRC}，跳过 AGENTS.md 处理"
    return 0
  fi
  if [ ! -f "${AGENTS_TGT}" ]; then
    cp "${AGENTS_SRC}" "${AGENTS_TGT}"
    echo "AGENTS.md: 目标不存在，已复制到 ${AGENTS_TGT}"
    return 0
  fi
  if cmp -s "${AGENTS_SRC}" "${AGENTS_TGT}"; then
    echo "AGENTS.md: 与目标内容一致，无需处理"
    return 0
  fi
  local tmp_agents="${AGENTS_TGT}.merge.$$"
  trap 'rm -f "${tmp_agents}"' EXIT
  awk -v src="${AGENTS_SRC}" -v tgt="${AGENTS_TGT}" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    BEGIN {
      cnt = 0; cur = "@HEADER@"
      while ((getline line < src) > 0) {
        if (line ~ /^## /) {
          cur = trim(substr(line, 4))
          if (!(cur in seen)) { seen[cur] = 1; sorder[++cnt] = cur }
          secs[cur] = line "\n"
        } else {
          secs[cur] = secs[cur] line "\n"
        }
      }
      close(src)
      m = 0; cur2 = "@HEADER@"; copymode = 1
      while ((getline line < tgt) > 0) {
        if (line ~ /^## /) {
          cur2 = trim(substr(line, 4))
          if (!(cur2 in tseen)) { tseen[cur2] = 1; torder[++m] = cur2 }
          if (cur2 in secs) {
            tsecs[cur2] = secs[cur2]
            copymode = 0
          } else {
            tsecs[cur2] = tsecs[cur2] line "\n"
            copymode = 1
          }
        } else if (copymode) {
          tsecs[cur2] = tsecs[cur2] line "\n"
        }
      }
      close(tgt)
      printf "%s", tsecs["@HEADER@"]
      for (i = 1; i <= m; i++) printf "%s", tsecs[torder[i]]
      for (i = 1; i <= cnt; i++) {
        n = sorder[i]
        if (!(n in tseen)) printf "%s", secs[n]
      }
      for (i = 1; i <= cnt; i++) {
        n = sorder[i]
        if (n in tseen) print "AGENTS.md 覆盖规则: " n > "/dev/stderr"
        else print "AGENTS.md 新增规则: " n > "/dev/stderr"
      }
    }
  ' > "${tmp_agents}"
  mv "${tmp_agents}" "${AGENTS_TGT}"
  trap - EXIT
  echo "AGENTS.md: 已按规则名称合并到 ${AGENTS_TGT}（同名覆盖 / 目标独有保留 / 新增追加）"
}

remove_agents() {
  if [ ! -f "${AGENTS_SRC}" ]; then
    echo "未找到 ${AGENTS_SRC}，跳过 AGENTS.md 处理"
    return 0
  fi
  if [ ! -f "${AGENTS_TGT}" ]; then
    echo "AGENTS.md: 目标不存在，无需处理"
    return 0
  fi
  if cmp -s "${AGENTS_SRC}" "${AGENTS_TGT}"; then
    rm -f "${AGENTS_TGT}"
    echo "AGENTS.md: 目标仅含本项目内容，已删除 ${AGENTS_TGT}"
    return 0
  fi
  local tmp_agents="${AGENTS_TGT}.merge.$$"
  trap 'rm -f "${tmp_agents}"' EXIT
  awk -v src="${AGENTS_SRC}" -v tgt="${AGENTS_TGT}" '
    function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    BEGIN {
      cnt = 0
      while ((getline line < src) > 0) {
        if (line ~ /^## /) {
          cur = trim(substr(line, 4))
          if (!(cur in seen)) { seen[cur] = 1; removed[cnt++] = cur }
        }
      }
      close(src)
      copy = 1; wrote = 0
      while ((getline line < tgt) > 0) {
        if (line ~ /^## /) {
          h = trim(substr(line, 4))
          copy = (!(h in seen))
          if (!copy) { print "AGENTS.md 移除规则: " h > "/dev/stderr"; continue }
        }
        if (copy) { printf "%s", line "\n"; wrote = 1 }
      }
      close(tgt)
      if (!wrote) print "AGENTS.md 警告: 移除后目标为空" > "/dev/stderr"
    }
  ' > "${tmp_agents}"
  mv "${tmp_agents}" "${AGENTS_TGT}"
  trap - EXIT
  echo "AGENTS.md: 已从 ${AGENTS_TGT} 移除本项目规则（目标独有规则保留）"
}

# ---- 主流程：参数解析 ----
usage_error() {
  echo "错误: $1" >&2
  echo "运行 '${0} --help' 查看用法。" >&2
  exit 1
}

CMD=""
DIR_ARG=""
DIR_FROM_POSITIONAL=0
POSITIONAL=()

while [ $# -gt 0 ]; do
  case "$1" in
    install|--install)
      [ -n "${CMD}" ] && usage_error "重复指定命令: '$1'"
      CMD="install"
      shift
      ;;
    uninstall|--uninstall)
      [ -n "${CMD}" ] && usage_error "重复指定命令: '$1'"
      CMD="uninstall"
      shift
      ;;
    list|--list)
      [ -n "${CMD}" ] && usage_error "重复指定命令: '$1'"
      CMD="list"
      shift
      ;;
    --help|-h|help)
      usage
      exit 0
      ;;
    --path)
      [ -n "${DIR_ARG}" ] && usage_error "重复指定 --path"
      [ $# -lt 2 ] && usage_error "--path 需要一个目录参数"
      DIR_ARG="$2"
      shift 2
      ;;
    --path=*)
      [ -n "${DIR_ARG}" ] && usage_error "重复指定 --path"
      DIR_ARG="${1#--path=}"
      [ -z "${DIR_ARG}" ] && usage_error "--path 需要一个目录参数"
      shift
      ;;
    -*)
      usage_error "未知选项 '$1'"
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [ -z "${CMD}" ]; then
  if [ -n "${DIR_ARG}" ]; then
    usage_error "--path 必须与 install/uninstall/list 命令一起使用"
  fi
  usage
  exit 0
fi

if [ "${#POSITIONAL[@]}" -gt 1 ]; then
  usage_error "参数过多: '${POSITIONAL[1]}'"
fi
if [ "${#POSITIONAL[@]}" -eq 1 ]; then
  if [ -n "${DIR_ARG}" ]; then
    usage_error "--path 与位置目录参数不能同时指定"
  fi
  DIR_ARG="${POSITIONAL[0]}"
  DIR_FROM_POSITIONAL=1
fi

# 位置参数形式的目录（有命令歧义）：必须为已存在目录或绝对路径
if [ "${DIR_FROM_POSITIONAL}" -eq 1 ] && [ ! -d "${DIR_ARG}" ]; then
  case "${DIR_ARG}" in
    /*) ;;
    *) usage_error "未知命令或目录不存在: '${DIR_ARG}'" ;;
  esac
fi

resolve_target "${DIR_ARG}"

# ---- 执行 ----
case "${CMD}" in
  install)
    install_skills
    merge_agents
    if [ "${TARGET_DIR}" = "${DEFAULT_TARGET}" ]; then
      echo "已安装到全局目录，任何会话都会加载生效（新会话起效）。"
    fi
    ;;
  uninstall)
    uninstall_skills
    remove_agents
    ;;
  list)
    list_skills
    ;;
esac
