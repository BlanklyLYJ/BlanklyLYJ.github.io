---
title: Unity Editor 扩展(EditorWindow / Inspector / 工具)
date: 2024-08-10 23:30:00
updated: 2024-08-10 23:30:00
tags:
  - Unity
  - Editor
  - EditorWindow
  - Inspector
  - AssetDatabase
categories:
  - [Unity, 编辑器扩展]
comments: true
---

> Editor 扩展是 Unity 工程师的必备技能,能省下大量重复劳动。这一篇整合 EditorWindow 自定义窗口、CustomEditor 改写 Inspector、Selection / AssetDatabase 操作资源、MenuItem /ContextMenu 菜单、PropertyDrawer 自定义绘制等常用套路,把日常开发中的"批处理需求"全部覆盖。

## 一、菜单系统:MenuItem

### 1.1 顶部菜单栏

```csharp
using UnityEditor;
using UnityEngine;

public class MyTools
{
    [MenuItem("Tools/Clean PlayerPrefs")]
    public static void CleanPlayerPrefs()
    {
        PlayerPrefs.DeleteAll();
        Debug.Log("PlayerPrefs cleared");
    }

    [MenuItem("Tools/Log Selected Path")]
    public static void LogSelectedPath()
    {
        if (Selection.activeObject != null)
        {
            string path = AssetDatabase.GetAssetPath(Selection.activeObject);
            Debug.Log(path);
        }
    }
}
```

`MenuItem` 在顶部菜单栏添加项,**静态方法**才能挂。路径用 `/` 分隔,可以嵌套。

### 1.2 优先级和分组

```csharp
[MenuItem("Tools/Group A/Item 1", priority = 0)]
[MenuItem("Tools/Group A/Item 2", priority = 1)]
[MenuItem("Tools/Group B/Item 3", priority = 100)]  // 跨 50 以上自动加分隔线
```

`priority` 差值 ≥ 50 时,菜单会插入分隔线。

### 1.3 验证函数

```csharp
[MenuItem("Tools/Process Prefab", true)]  // 第二参数 true 表示 validation
public static bool ValidateProcessPrefab()
{
    return Selection.activeObject != null;
}
```

返回 `false` 时菜单灰显不可点。

<!-- more -->

### 1.4 Hierarchy / Project 右键菜单

```csharp
// GameObject 菜单(Hierarchy 右键 + 顶部 GameObject 菜单)
[MenuItem("GameObject/My Tools/Create Special", false, 10)]
static void CreateSpecialGameObject()
{
    var go = new GameObject("Special");
    go.AddComponent<SpecialComponent>();
}

// Assets 菜单(Project 右键)
[MenuItem("Assets/My Tools/Find Usages")]
static void FindUsages()
{
    // 选中的资源 → 查找引用
}
```

### 1.5 ContextMenu(组件右键)

```csharp
public class Player : MonoBehaviour
{
    public int hp = 100;

    [ContextMenu("Reset HP")]
    void ResetHP() => hp = 100;
}
```

或者给字段加 `[ContextMenuItem]`:

```csharp
[ContextMenuItem("Reset", "ResetName")]
public string playerName;

void ResetName() => playerName = "Default";
```

### 1.6 ScriptableObject 创建菜单

```csharp
[CreateAssetMenu(fileName = "NewConfig", menuName = "Configs/MyConfig", order = 0)]
public class MyConfig : ScriptableObject { }
```

Project 窗口右键 → Create → Configs → MyConfig。

## 二、EditorWindow:自定义窗口

### 2.1 最简 EditorWindow

```csharp
public class MyWindow : EditorWindow
{
    [MenuItem("Tools/My Window")]
    public static void Open()
    {
        var window = GetWindow<MyWindow>("My Window");
        window.minSize = new Vector2(300, 200);
    }

    private string _input = "";
    private void OnGUI()
    {
        GUILayout.Label("Settings", EditorStyles.boldLabel);
        _input = EditorGUILayout.TextField("Name", _input);

        if (GUILayout.Button("Apply"))
        {
            Debug.Log("Applied: " + _input);
        }
    }
}
```

`OnGUI` 是立即模式 GUI,每帧重新绘制。`GetWindow<T>` 创建或获取窗口实例(单例)。

### 2.2 常用绘制元素

```csharp
// 文本
EditorGUILayout.LabelField("Label", "value");
_text = EditorGUILayout.TextField("Text", _text);
_int = EditorGUILayout.IntField("Int", _int);
_float = EditorGUILayout.FloatField("Float", _float);
_vec3 = EditorGUILayout.Vector3Field("Vec3", _vec3);
_color = EditorGUILayout.ColorField("Color", _color);
_rect = EditorGUILayout.RectField("Rect", _rect);

// 选择
_toggle = EditorGUILayout.Toggle("Toggle", _toggle);
_index = EditorGUILayout.Popup("Popup", _index, new[] { "A", "B", "C" });
_enum = (MyEnum)EditorGUILayout.EnumPopup("Enum", _enum);
_layer = EditorGUILayout.LayerField("Layer", _layer);

// 滑动条
_slider = EditorGUILayout.Slider("Slider", _slider, 0, 100);

// 对象字段
_obj = EditorGUILayout.ObjectField("Object", _obj, typeof(GameObject), false);

// 按钮
if (GUILayout.Button("Click")) DoSomething();
if (GUILayout.Button("Wide", GUILayout.Height(40), GUILayout.Width(200))) { }

// 折叠
_showGroup = EditorGUILayout.BeginFoldoutHeaderGroup(_showGroup, "Group");
if (_showGroup)
{
    EditorGUILayout.IntField("A", 1);
    EditorGUILayout.IntField("B", 2);
}
EditorGUILayout.EndFoldoutHeaderGroup();
```

### 2.3 EditorGUI vs EditorGUILayout

| API | 风格 | 用途 |
|---|---|---|
| `GUI` / `GUILayout` | 通用 IMGUI | Game 视图调试 GUI |
| `EditorGUI` / `EditorGUILayout` | 编辑器专用 | Inspector / EditorWindow,支持 ObjectField 等 |

`EditorGUILayout` 自动管理布局(垂直排列),`EditorGUI` 需要手动指定 Rect。

### 2.4 滚动视图与启用禁用

```csharp
private Vector2 _scroll;

private void OnGUI()
{
    // 启用 / 禁用整块
    EditorGUI.BeginDisabledGroup(_locked);
    {
        // 输入控件...
    }
    EditorGUI.EndDisabledGroup();

    // 滚动视图
    _scroll = EditorGUILayout.BeginScrollView(_scroll);
    {
        for (int i = 0; i < 100; i++)
            EditorGUILayout.LabelField("Item " + i);
    }
    EditorGUILayout.EndScrollView();
}
```

### 2.5 持久化数据

```csharp
// EditorPrefs 保存(跨会话)
private int _count
{
    get => EditorPrefs.GetInt("MyWindow.Count", 0);
    set => EditorPrefs.SetInt("MyWindow.Count", value);
}

// 也可以用 ScriptableObject 持久化更复杂的配置
```

### 2.6 保存修改标记(脏标记)

修改 EditorWindow 中的数据后,如果不主动调用 `SetDirty`,Unity 不知道数据变了,关闭窗口或退出 Unity 时可能不保存。

```csharp
[CustomEditor(typeof(Car))]
public class CarEditor : Editor
{
    private Car _car;

    public override void OnInspectorGUI()
    {
        _car = (Car)target;
        _car.wheelCount = EditorGUILayout.IntSlider("Wheel", _car.wheelCount, 0, 20);

        if (GUI.changed)
        {
            EditorUtility.SetDirty(target);   // 标记为已修改,会被保存
        }
    }
}
```

### 2.7 EditorCoroutine:Editor 下的协程

`Update` 在 Editor 中不调用,普通协程在 EditorWindow 里也不工作。Unity 提供 **Editor Coroutines** 包(Package Manager 安装):

```csharp
using UnityEditor;

public class MyWindow : EditorWindow
{
    [MenuItem("Tools/My Window")]
    public static void Open() => GetWindow<MyWindow>("My");

    private void OnEnable()
    {
        EditorCoroutineUtility.StartCoroutineOwnerless(DoWork());
    }

    private System.Collections.IEnumerator DoWork()
    {
        for (int i = 0; i < 10; i++)
        {
            Debug.Log("Tick " + i);
            // Editor 协程只能 yield null 或 WaitForEndOfFrame / WaitForSecondsRealtime
            yield return new WaitForSecondsRealtime(0.5f);
        }
    }
}
```

常见用途:
- EditorWindow 里跑后台任务(批量处理资源、网络下载)
- 等异步操作完成
- 进度条 / 状态动画

> Editor 协程只在 Unity Editor 进程里跑,不会进游戏运行时;关闭窗口 / 退出 Unity 自动停。

## 三、CustomEditor:改写 Inspector

### 3.1 基本 CustomEditor

```csharp
[CustomEditor(typeof(Player))]
public class PlayerEditor : Editor
{
    private Player _target;
    private SerializedProperty _hpProp;

    private void OnEnable()
    {
        _target = (Player)target;
        _hpProp = serializedObject.FindProperty("hp");
    }

    public override void OnInspectorGUI()
    {
        serializedObject.Update();

        EditorGUILayout.PropertyField(_hpProp, new GUIContent("HP"));
        EditorGUILayout.LabelField("Status", _target.hp > 0 ? "Alive" : "Dead");

        if (GUILayout.Button("Full Heal"))
        {
            _target.hp = 100;
            EditorUtility.SetDirty(_target);
        }

        serializedObject.ApplyModifiedProperties();
    }
}
```

**关键流程**:
1. `serializedObject.Update()` 把目标对象的数据同步到 SerializedObject
2. 用 `PropertyField` 绘制
3. `ApplyModifiedProperties()` 把修改写回目标

### 3.2 SerializedObject 的优势

| 方式 | 优点 | 缺点 |
|---|---|---|
| 直接访问 target | 灵活 | 不支持 Undo / Prefab 覆盖 / 多选编辑 |
| SerializedObject + PropertyField | 自动支持 Undo / Prefab / 多选 | 略复杂 |

**永远优先用 SerializedObject**,除非有特殊绘制需求。

### 3.3 控制属性显示

```csharp
public class Weapon : MonoBehaviour
{
    public int type;
    public bool explosive;

    [HideInInspector]                       // 隐藏 public 字段
    public float internalValue;

    [SerializeField]                        // 显示 private 字段
    private int hiddenInInspector = 5;

    [Range(0, 100)]                         // 滑动条
    public int damage;

    [Tooltip("Weapon name")]
    public string weaponName;

    [Space(20)]                             // 留白
    [Header("Combat Settings")]             // 标题
    public float attackRange;
    public float attackSpeed;

    [ContextMenu("Reset", "ResetValues")]   // 右键菜单
    public void ResetValues() { /* ... */ }
}
```

### 3.4 ConditionalHide(条件显示)

Unity 没内置"满足条件才显示",自己写 PropertyDrawer:

```csharp
[AttributeUsage(AttributeTargets.Field)]
public class ConditionalHideAttribute : PropertyAttribute
{
    public string ComparedPropertyName;
    public object CompareValue;

    public ConditionalHideAttribute(string comparedPropertyName, object compareValue = null)
    {
        ComparedPropertyName = comparedPropertyName;
        CompareValue = compareValue;
    }
}

[CustomPropertyDrawer(typeof(ConditionalHideAttribute))]
public class ConditionalHideDrawer : PropertyDrawer
{
    public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
    {
        var attr = (ConditionalHideAttribute)attribute;
        var condProp = property.serializedObject.FindProperty(attr.ComparedPropertyName);

        bool show = false;
        if (condProp != null)
        {
            switch (condProp.propertyType)
            {
                case SerializedPropertyType.Boolean:
                    show = condProp.boolValue.Equals(attr.CompareValue ?? true);
                    break;
                case SerializedPropertyType.Enum:
                    show = condProp.enumValueIndex.Equals((int)(attr.CompareValue ?? 0));
                    break;
            }
        }

        if (show)
            EditorGUI.PropertyField(position, property, label);
    }

    public override float GetPropertyHeight(SerializedProperty property, GUIContent label)
    {
        var attr = (ConditionalHideAttribute)attribute;
        var condProp = property.serializedObject.FindProperty(attr.ComparedPropertyName);
        bool show = condProp != null && condProp.boolValue;
        return show ? base.GetPropertyHeight(property, label) : 0;
    }
}

// 使用
public class Gun : MonoBehaviour
{
    public bool isExplosive;
    [ConditionalHide("isExplosive", true)]
    public float explosiveRadius;
}
```

## 四、PropertyDrawer:自定义字段绘制

PropertyDrawer 给自定义类做特殊绘制:

```csharp
[Serializable]
public class RangeFloat
{
    public float min;
    public float max;
}

[CustomPropertyDrawer(typeof(RangeFloat))]
public class RangeFloatDrawer : PropertyDrawer
{
    public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
    {
        EditorGUI.BeginProperty(position, label, property);

        var minProp = property.FindPropertyRelative("min");
        var maxProp = property.FindPropertyRelative("max");

        position = EditorGUI.PrefixLabel(position, GUIUtility.GetControlID(FocusType.Passive), label);

        float labelW = 30f, spacing = 5f;
        float fieldW = (position.width - labelW * 2 - spacing * 2) / 2;

        Rect minLabel = new Rect(position.x, position.y, labelW, position.height);
        Rect minField = new Rect(position.x + labelW, position.y, fieldW, position.height);
        Rect maxLabel = new Rect(position.x + labelW + fieldW + spacing, position.y, labelW, position.height);
        Rect maxField = new Rect(position.x + labelW * 2 + fieldW + spacing * 2, position.y, fieldW, position.height);

        EditorGUI.LabelField(minLabel, "Min");
        minProp.floatValue = EditorGUI.FloatField(minField, minProp.floatValue);
        EditorGUI.LabelField(maxLabel, "Max");
        maxProp.floatValue = EditorGUI.FloatField(maxField, maxProp.floatValue);

        EditorGUI.EndProperty();
    }
}
```

## 五、Selection 与 AssetDatabase

### 5.1 Selection API

```csharp
// 当前选中
GameObject selected = Selection.activeGameObject;
Object asset = Selection.activeObject;
GameObject[] all = Selection.gameObjects;
Object[] allObjects = Selection.objects;

// 高亮 + 选中(类似 Project 窗口点击)
void OpenPrefabPath(string path)
{
    Object obj = AssetDatabase.LoadAssetAtPath<Object>(path);
    EditorGUIUtility.PingObject(obj);          // 高亮(闪烁)
    Selection.activeObject = obj;               // 选中(Inspector 显示)
}

// 监听选择变化
private void OnSelectionChange()  // EditorWindow 内
{
    Repaint();
}
```

### 5.2 AssetDatabase:资源操作

```csharp
// 查找资源(返回 GUID 数组)
string[] guids = AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/UI" });
foreach (var guid in guids)
{
    string path = AssetDatabase.GUIDToAssetPath(guid);
    GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
    // ...
}

// 创建
AssetDatabase.CreateAsset(asset, "Assets/New.asset");

// 添加多个对象到一个 .asset
AssetDatabase.AddObjectToAsset(obj, mainAsset);

// 保存
AssetDatabase.SaveAssets();
AssetDatabase.Refresh();   // 重新导入

// 修改后必须 SetDirty
EditorUtility.SetDirty(asset);
```

### 5.3 遍历所有 Prefab

```csharp
[MenuItem("Tools/Check Text Font")]
public static void CheckTextFont()
{
    string[] guids = AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/GameResources/UI" });
    foreach (var guid in guids)
    {
        string path = AssetDatabase.GUIDToAssetPath(guid);
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        if (prefab == null) continue;

        var texts = prefab.GetComponentsInChildren<Text>(true);
        foreach (var text in texts)
        {
            if (text.font == null) continue;
            if (text.font.name is "Arial" or "Radio")
                Debug.Log($"[{prefab.name}] {text.name}: {text.font.name}");
        }
    }
}
```

### 5.4 保存 / 修改 Prefab

```csharp
public static bool SavePrefab(GameObject go, string path)
{
    if (go == null) return false;

    // 确保目录存在(GetDirectoryName 对 "Assets/x.prefab" 返回 "Assets",对 "x.prefab" 返回 "")
    string dir = Path.GetDirectoryName(path);
    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        Directory.CreateDirectory(dir);

    PrefabUtility.SaveAsPrefabAsset(go, path, out bool success);
    AssetDatabase.SaveAssets();
    AssetDatabase.Refresh();
    return success;
}

// 修改现有 Prefab
string prefabPath = AssetDatabase.GetAssetPath(targetPrefab);
GameObject root = PrefabUtility.LoadPrefabContents(prefabPath);
try
{
    // 修改 root...
    PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
}
finally
{
    PrefabUtility.UnloadPrefabContents(root);  // 必须卸载
}
```

`LoadPrefabContents` 是修改 Prefab 的安全方式,不会污染场景。

### 5.5 AssetPostprocessor:资源导入钩子

资源导入(拖图、模型、音频进 Project)时自动回调,常用于**强制规范**——团队任何人拖进来的资源都自动符合标准,不用后续检查:

```csharp
public class TextureImporterSettings : AssetPostprocessor
{
    private void OnPreprocessTexture()
    {
        // 拖进 Project 的纹理,导入前调用
        var importer = (TextureImporter)assetImporter;
        importer.maxTextureSize = 1024;
        importer.textureCompression = TextureImporterCompression.Compressed;
        importer.androidFormat = TextureImporterFormat.ASTC_RGBA_6x6;
        importer.isReadable = false;
        Debug.Log($"[Texture] Preprocess: {assetPath}");
    }

    private void OnPostprocessTexture(Texture2D texture)
    {
        // 导入完成后
    }

    // 任意资源批量导入完成后
    private static void OnPostprocessAllAssets(
        string[] imported, string[] deleted, string[] moved, string[] movedFrom)
    {
        foreach (var p in imported)
            Debug.Log($"Imported: {p}");
    }
}
```

常用钩子:
- `OnPreprocessTexture` / `OnPostprocessTexture`
- `OnPreprocessModel` / `OnPostprocessModel`
- `OnPreprocessAudio` / `OnPostprocessAudio`
- `OnPostprocessAllAssets`(任意资源批量回调)

> 配合渲染篇"资源检测系统",能让规范**前置**——导入即合规,而不是事后扫描纠正。

## 六、内建 Icon 与 EditorGUIUtility

Unity 内置了大量 Icon,通过 `AssetDatabase.FindTexture` 或 `EditorGUIUtility.IconContent` 拿到:

```csharp
// 按 Icon 名查找
Texture2D icon = AssetDatabase.FindTexture("console.erroricon");
GUILayout.Label(icon);

// IconContent 自动加上 tooltip
GUIContent content = EditorGUIUtility.IconContent("Toolbar Plus");
if (GUILayout.Button(content)) { }

// 系统内置 Icon 列表(查看):
// https://unitylist.com/?p=04t
```

## 七、Gizmos / Handles:场景视图绘制

### 7.1 OnDrawGizmos

```csharp
public class SpawnPoint : MonoBehaviour
{
    public float radius = 1f;
    public Color color = Color.green;

    private void OnDrawGizmos()
    {
        Gizmos.color = color;
        Gizmos.DrawWireSphere(transform.position, radius);
    }

    private void OnDrawGizmosSelected()
    {
        // 只在选中时画
        Gizmos.color = Color.red;
        Gizmos.DrawSphere(transform.position, radius * 1.2f);
    }
}
```

### 7.2 Handles(场景 UI)

```csharp
[CustomEditor(typeof(SpawnPoint))]
public class SpawnPointEditor : Editor
{
    private void OnSceneGUI()
    {
        var sp = (SpawnPoint)target;
        Handles.color = Color.yellow;
        Handles.Label(sp.transform.position + Vector3.up, "Spawn " + sp.name);
    }
}
```

## 八、构建相关

### 8.1 BuildPlayer API

```csharp
[MenuItem("Build/Android Release")]
public static void BuildAndroid()
{
    string[] scenes = EditorBuildSettings.scenes
        .Where(s => s.enabled)
        .Select(s => s.path)
        .ToArray();

    BuildPlayerOptions options = new BuildPlayerOptions
    {
        scenes = scenes,
        locationPathName = "Builds/Android/app.apk",
        target = BuildTarget.Android,
        options = BuildOptions.None
    };

    BuildPipeline.BuildPlayer(options);
}
```

### 8.2 IPreprocessBuild / IPostprocessBuild

```csharp
public class MyBuildProcessor : IPreprocessBuildWithReport, IPostprocessBuildWithReport
{
    public int callbackOrder => 0;

    public void OnPreprocessBuild(BuildReport report)
    {
        Debug.Log("Build start: " + report.summary.platform);
    }

    public void OnPostprocessBuild(BuildReport report)
    {
        Debug.Log("Build done, size: " + report.summary.totalSize);
    }
}
```

## 九、实战:批量清理 Text 引用

```csharp
[MenuItem("Tools/Replace Arial with TMP")]
public static void ReplaceArial()
{
    string[] guids = AssetDatabase.FindAssets("t:Prefab");
    int count = 0;
    foreach (var guid in guids)
    {
        string path = AssetDatabase.GUIDToAssetPath(guid);
        var go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        if (go == null) continue;

        var texts = go.GetComponentsInChildren<Text>(true);
        bool dirty = false;
        foreach (var t in texts)
        {
            if (t.font != null && t.font.name == "Arial")
            {
                // 替换字体...
                dirty = true;
            }
        }

        if (dirty)
        {
            EditorUtility.SetDirty(go);
            count++;
        }
    }
    AssetDatabase.SaveAssets();
    Debug.Log($"Updated {count} prefabs");
}
```

## 参考

- [Unity Editor API](https://docs.unity3d.com/ScriptReference/Editor.html)
- [EditorWindow 自定义窗口](https://wenku.baidu.com/view/f51bcc39660e52ea551810a6f524ccbff121cad2.html)
- [Selection API](https://blog.csdn.net/z_c_s/article/details/120183948)
- [PropertyDrawer 自定义绘制](https://docs.unity3d.com/ScriptReference/PropertyDrawer.html)

---

下一篇:[Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/) — 整合 Input 系统、EventSystem、Pointer 事件、自定义交互组件。

## 系列目录

1. [Unity 生命周期、MonoBehaviour 与场景管理](/2024/08/10/unity-lifecycle-mono-scene/)
2. [Unity UGUI 基础组件](/2024/08/10/unity-ugui-basics/)
3. [Unity UGUI 进阶(ScrollRect / Mask / 布局)](/2024/08/10/unity-ugui-advanced/)
4. [Unity 协程(Coroutine / IEnumerator)](/2024/08/10/unity-coroutine/)
5. Unity Editor 扩展(本篇)
6. [Unity 输入与交互(Input / EventSystem)](/2024/08/10/unity-input-eventsystem/)
7. [Unity 动画系统与 DoTween](/2024/08/10/unity-animation-tween/)
8. [Unity 渲染优化与 DOTS](/2024/08/10/unity-rendering-optimization/)
9. [Unity Android 构建与调试](/2024/08/10/unity-android-build-debug/)
10. [Unity 杂项技巧与框架](/2024/08/10/unity-tips-framework/)
