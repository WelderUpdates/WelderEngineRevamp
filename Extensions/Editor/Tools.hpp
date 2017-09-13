///////////////////////////////////////////////////////////////////////////////
///
/// \file Tools.hpp
/// Declaration of the Tools classes.
/// 
/// Authors: Chris Peters
/// Copyright 2010-2012, DigiPen Institute of Technology
///
///////////////////////////////////////////////////////////////////////////////
#pragma once

namespace Zero
{

class Viewport;
class KeyboardEvent;
class MouseEvent;
class PropertyView;
class UpdateEvent;
struct Joint;
struct BaseCastFilter;
class ViewportMouseEvent;
class Mouse;

//----------------------------------------------------------------------- Events
namespace Events
{
DeclareEvent(SelectToolPreSelect);
DeclareEvent(SelectToolFrustumCast);
DeclareEvent(SelectToolPreDraw);
}

class SelectToolFrustumEvent : public Event
{
public:
  ZilchDeclareType(TypeCopyMode::ReferenceType);

  SelectToolFrustumEvent( ) : Handled(false), HandledEventScript(false) {}

  Space* GetSpace( );
  Frustum GetFrustum( );

  bool Handled;
  bool HandledEventScript;

  Space* mSpace;
  Frustum mFrustum;
};

//------------------------------------------------------------------ Select Tool
/// <Commands>
///   <command name = "MultiSelect">
///     <shortcut> Shift + Drag </shortcut>
///     <description>
///       Select all objects inside the box bound by the initial drag point and
///       the current mouse cursor position.
///     </description>
///   </command>
/// </Commands>
class SelectTool : public Component
{
public:
  typedef RaycastResultList::RayCastEntries RayCastEntries;
  /// Meta Initialization.
  ZilchDeclareType(TypeCopyMode::ReferenceType);

  /// Constructor.
  SelectTool();
  
  /// Component Interface.
  void Serialize(Serializer& stream) override;
  void Initialize(CogInitializer& initializer) override;

  /// Draw all selected objects.
  void OnToolDraw(Event* e);

  /// Highlight what object the mouse is currently over.
  void OnMouseUpdate(ViewportMouseEvent* e);

  /// Select objects on mouse up.
  void OnLeftMouseUp(ViewportMouseEvent* e);

  // Checks whether an object is the currently selected archetype
  bool IsLastHitArchetype(Cog* cog);
  // Checks whether an object is a direct child of the last selected archetype
  bool IsDirectChildOfLastHitArchetype(Cog* cog);
  // Checks whether the root archetype for the cog is the same as the last selected object
  bool SameRootAsLastHitArchetype(Cog* cog);
  // Select an object based on the its archetype/sub-archetype hierarchy
  bool ArchetypeSelect(Cog* toSelect, RaycastResultList& result);
  // Select an object based on its hierarchy
  bool HierarchySelect(Cog* toSelect, RaycastResultList& result);

  // Checks whether an object is the root of currently selected hierarchy
  bool IsLastHitHierarchyRoot(Cog* cog);
  // Checks whether an object is a direct child of the last selected hierarchy
  bool IsChildOfLastHitHierarchyRoot(Cog* cog);

  void Select(ViewportMouseEvent* e);
  SelectionResult RayCastSelect(Viewport* viewport, Vec2 mousePosition);
  RaycastResultList RayCastSelectInternal(Viewport* viewport, Vec2 mousePosition);

  Cog* RayCast(Viewport* viewport, Vec2 mousePosition);

  /// Add a provider for testing raycasting. Note: The tool expects
  /// to own the provider passed in (aka it calls delete on it).
  void AddCastProvider(RaycastProvider* provider);

  //Regular expressions
  String mFilterAccept;
  String mFilterReject;

  ///Selects the root archetype of the tree,
  ///subsequent clicks will select the nearest archetype
  ///followed by any direct children following that.
  bool mArchetypeSelect;

  ///Selects the root of a hierarchy first,
  ///subsequent clicks will select children objects
  bool mRootSelect;
  
  ///If a parent of a hierarchy is already selected drag select will only select all the children
  ///of the currently selected parent.
  bool mSmartGroupSelect;

  HandleOf<Cog> mLastHitArchetype;
  HandleOf<Cog> mLastHitHierarchyRoot;

  //stores all of the providers for raycasting and does the actual casting.
  Raycaster mRaycaster;
};

//---------------------------------------------------------------- Creation Tool
DeclareEnum6(Placement, OnTop, LookAtPlane, LookAtPoint, ViewAtDepth, CameraLocation, PlaneXY);

class CreationTool : public Component
{
public:
  /// Meta Initialization.
  ZilchDeclareType(TypeCopyMode::ReferenceType);

  /// Constructor
  CreationTool();

  /// Component Interface.
  void Serialize(Serializer& stream) override;
  void Initialize(CogInitializer& initializer) override;
  
  /// Create the object when the mouse is clicked.
  void OnLeftMouseDown(ViewportMouseEvent* e);

  /// When the mouse moves, we want to update to show where the object
  /// would be created.
  void OnMouseMove(ViewportMouseEvent* e);

  /// Draw where the object would be created.
  void OnToolDraw(Event* e);

  /// Functions
  void UpdateMouse(Viewport* viewport, Vec2 screenPosition);
  Cog* CreateAt(Viewport* viewport, Archetype* archetypeName, 
                Vec3Param position);
  Cog* CreateWithViewport(Viewport* viewport, Vec2 screenPosition, 
                          StringParam archetypeName);
  Cog* CreateWithViewport(Viewport* viewport, Vec2 screenPosition, 
                          Archetype* archetype);

  Vec3 PointOnViewPlane(EditorCameraController* controller, Ray& worldRay);
  Vec3 PointOnTopOrViewPlane(Viewport* viewport, EditorCameraController* controller, Ray& worldRay);
  Vec3 GetPlacementLocation(Viewport* viewport, Vec2 screenPosition);

  /// The object that is spawned.
  Archetype* GetObjectToSpawn();
  void SetObjectToSpawn(Archetype* archetype);

  /// The object that is spawned.
  HandleOf<Archetype> mObjectToSpawn;
  /// Predetermined spawning modes for object being created.
  Placement::Enum mPlacementMode;
  /// Tool movement becomes non-contiguous.
  bool mSnapping;
  /// Distance tool updates per each movement.
  float mSnapDistance;
  /// Tool offset from mouse position or predetermined spawn location.
  Vec3 mOffset;
  /// Spawn point distance from camera when using ViewAtDepth mode. 
  float mDepth;
  float mDepthPlane;
  Vec3 mTargetPoint;
  Vec3 mMouseDir;
  Vec2 mMousePos;
  bool mValidPoint;
  //stores all of the providers for raycasting
  Raycaster mRaycaster;
};

//------------------------------------------------------- Object Connecting Tool
/// <Commands>
///   <command name = "ToolDeactivate">
///     <shortcut> Esc </shortcut>
///     <description>
///       Deactivate the Object Connecting Tool.
///     </description>
///   </command>
/// </Commands>
class ObjectConnectingTool : public Component
{
public:
  /// Meta Initialization.
  ZilchDeclareType(TypeCopyMode::ReferenceType);

  ObjectConnectingTool();

  /// Component Interface.
  void Initialize(CogInitializer& initializer) override;

  /// Start the event connection when a mouse clicks on an object.
  void OnLeftMouseDown(ViewportMouseEvent* e);
  
  /// Draw the connection being made.
  void OnToolDraw(Event* e);

  /// Cancel the manipulation when Escape is pressed.
  void OnKeyDown(KeyboardEvent* e);

  /// Look for a possible connection when the mouse moves.
  void OnMouseDragMove(ViewportMouseEvent* e);

  /// Do the connection when the drag ends.
  virtual void OnMouseEndDrag(Event*);

  /// Invalidate objects when we're disabled.
  void OnToolDeactivate(Event*);

  virtual void DoConnection()=0;

  Vec3 PointOnObjectA;
  Vec3 PointOnObjectB;
  CogId ObjectA;
  CogId ObjectB;
};

//--------------------------------------------------------------- Parenting Tool
/// <Commands>
///   <command name = "ToolDeactivate">
///     <shortcut> Esc </shortcut>
///     <description>
///       Deactivate the Parenting Tool.
///     </description>
///   </command>
/// </Commands>
class ParentingTool : public ObjectConnectingTool
{
public:
  /// Meta Initialization.
  ZilchDeclareType(TypeCopyMode::ReferenceType);

  ParentingTool();

  /// Component Interface.
  void Serialize(Serializer& stream) override;

  /// ObjectConnectingTool Interface.
  void DoConnection() override;

  bool mMaintainPosition;
};

}//namespace Zero
